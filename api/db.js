/**
 * ============================================================================
 * ONESPORT VERCEL DATABASE ADAPTER
 * Mendukung Vercel Postgres (@vercel/postgres / pg) dan Vercel KV (@vercel/kv).
 * Menyediakan fallback transparan saat berjalan di dev atau sebelum env database diatur.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

// In-memory fallback untuk local development / serverless standby
const DEFAULT_USERS = [
  {
    username: 'admin',
    email: 'admin@onesport.co.id',
    name: 'Admin OneSport',
    password: 'temanmainlebihdekat',
    role: 'host'
  },
  {
    username: 'user',
    name: 'Pemain OneSport',
    password: 'user123',
    role: 'user'
  }
];

const memoryStore = {
  states: new Map(),
  players: new Map(),
  users: new Map()
};

DEFAULT_USERS.forEach(u => memoryStore.users.set(u.username.toLowerCase(), { ...u }));

function getPostgresConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.POSTGRES_PRISMA_URL) return process.env.POSTGRES_PRISMA_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL_NON_POOLING) return process.env.POSTGRES_URL_NON_POOLING;
  if (process.env.SUPABASE_DATABASE_URL) return process.env.SUPABASE_DATABASE_URL;
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;

  // Fallback: Bentuk connection string dari komponen environment terpisah
  if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_DATABASE) {
    const user = encodeURIComponent(process.env.POSTGRES_USER);
    const pass = process.env.POSTGRES_PASSWORD ? encodeURIComponent(process.env.POSTGRES_PASSWORD) : '';
    const host = process.env.POSTGRES_HOST;
    const db = process.env.POSTGRES_DATABASE;
    return `postgres://${user}${pass ? ':' + pass : ''}@${host}/${db}?sslmode=require`;
  }
  return null;
}

function getProvider() {
  if (getPostgresConnectionString()) {
    return 'postgres';
  }
  if (
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    process.env.KV_URL ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    process.env.REDIS_URL
  ) {
    return 'kv';
  }
  return 'memory';
}

// ── 1. POSTGRES DRIVER ──
let pgPool = null;
let tablesInitialized = false;

async function getPgClient() {
  if (pgPool) return pgPool;

  const connectionString = getPostgresConnectionString();
  if (!connectionString) return null;

  try {
    // 1. Coba gunakan @vercel/postgres pool terlebih dahulu
    try {
      const vercelPg = require('@vercel/postgres');
      if (vercelPg && typeof vercelPg.createPool === 'function') {
        const pool = vercelPg.createPool({ connectionString });
        if (pool && typeof pool.query === 'function') {
          pgPool = pool;
          return pgPool;
        }
      }
    } catch (e) {}

    // 2. Fallback ke driver standar node-postgres (pg)
    const { Pool } = require('pg');
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    pgPool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
    return pgPool;
  } catch (err) {
    console.warn('[ONESPORT DB] Gagal inisialisasi driver Postgres:', err.message);
    return null;
  }
}

async function ensurePgTables(client) {
  if (tablesInitialized || !client) return;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS onesport_state (
        room_id VARCHAR(100) PRIMARY KEY,
        state_data JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS onesport_players (
        room_id VARCHAR(100) NOT NULL,
        player_id VARCHAR(100) NOT NULL,
        player_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, player_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS onesport_users (
        username VARCHAR(100) PRIMARY KEY,
        email VARCHAR(150),
        name VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO onesport_users (username, email, name, password, role)
      VALUES 
        ('admin', 'admin@onesport.co.id', 'Admin OneSport', 'temanmainlebihdekat', 'host'),
        ('user', null, 'Pemain OneSport', 'user123', 'user')
      ON CONFLICT (username) DO NOTHING;
    `);
    tablesInitialized = true;
  } catch (err) {
    console.warn('[ONESPORT DB] Init Postgres tables warning:', err.message);
  }
}

// ── 2. VERCEL KV DRIVER ──
let kvClient = null;
function getKvClient() {
  if (kvClient) return kvClient;
  try {
    const { kv } = require('@vercel/kv');
    kvClient = kv;
    return kvClient;
  } catch (e) {
    try {
      const { Redis } = require('@upstash/redis');
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        kvClient = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN
        });
        return kvClient;
      }
    } catch (err) {}
    return null;
  }
}

// ── 3. OPERASI STATE (GET & SET) ──
async function getState(roomId = 'DEFAULT') {
  const normRoom = String(roomId).trim().toUpperCase() || 'DEFAULT';
  const provider = getProvider();

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = 'SELECT state_data FROM onesport_state WHERE room_id = $1 LIMIT 1';
        const res = await client.query(query, [normRoom]);
        if (res && res.rows && res.rows.length > 0) {
          let val = res.rows[0].state_data;
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch (e) {}
          }
          return { data: val, provider: 'postgres' };
        }
        return { data: null, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getState error:', e.message);
      pgPool = null;
    }
  }

  if (provider === 'kv') {
    try {
      const kv = getKvClient();
      if (kv) {
        const val = await kv.get(`onesport:state:${normRoom}`);
        if (val) {
          return { data: typeof val === 'string' ? JSON.parse(val) : val, provider: 'kv' };
        }
        return { data: null, provider: 'kv' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] KV getState error:', e.message);
    }
  }

  // Memory fallback
  const mem = memoryStore.states.get(normRoom) || null;
  return { data: mem, provider: 'memory' };
}

async function saveState(roomId = 'DEFAULT', stateData) {
  const normRoom = String(roomId).trim().toUpperCase() || 'DEFAULT';
  const provider = getProvider();

  // Update memory store terlebih dahulu
  memoryStore.states.set(normRoom, stateData);

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = `
          INSERT INTO onesport_state (room_id, state_data, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (room_id)
          DO UPDATE SET state_data = $2, updated_at = CURRENT_TIMESTAMP
        `;
        const stateJson = JSON.stringify(stateData);
        await client.query(query, [normRoom, stateJson]);
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres saveState error:', e.message);
      pgPool = null;
    }
  }

  if (provider === 'kv') {
    try {
      const kv = getKvClient();
      if (kv) {
        await kv.set(`onesport:state:${normRoom}`, JSON.stringify(stateData));
        return { success: true, provider: 'kv' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] KV saveState error:', e.message);
    }
  }

  return { success: true, provider: 'memory' };
}

// ── 4. OPERASI PEMAIN (CRUD) ──
async function getPlayers(roomId = 'DEFAULT') {
  const normRoom = String(roomId).trim().toUpperCase() || 'DEFAULT';
  const provider = getProvider();

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = 'SELECT player_data FROM onesport_players WHERE room_id = $1 ORDER BY created_at ASC';
        const res = await client.query(query, [normRoom]);
        if (res && res.rows) {
          const list = res.rows.map(r => {
            let pd = r.player_data;
            if (typeof pd === 'string') {
              try { pd = JSON.parse(pd); } catch (e) {}
            }
            return pd;
          });
          return { players: list, provider: 'postgres' };
        }
        return { players: [], provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getPlayers error:', e.message);
      pgPool = null;
    }
  }

  // Fallback: Ambil dari state jika ada
  const st = await getState(normRoom);
  if (st && st.data && Array.isArray(st.data.bPlayers)) {
    return { players: st.data.bPlayers, provider: st.provider };
  }

  const memPlayers = memoryStore.players.get(normRoom) || [];
  return { players: memPlayers, provider: 'memory' };
}

async function savePlayer(roomId = 'DEFAULT', player) {
  if (!player || player.id === undefined) return { success: false, message: 'Invalid player' };
  const normRoom = String(roomId).trim().toUpperCase() || 'DEFAULT';
  const playerId = String(player.id);
  const provider = getProvider();

  // Simpan di memory store
  let memList = memoryStore.players.get(normRoom) || [];
  const existingIdx = memList.findIndex(p => String(p.id) === playerId);
  if (existingIdx >= 0) {
    memList[existingIdx] = player;
  } else {
    memList.push(player);
  }
  memoryStore.players.set(normRoom, memList);

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = `
          INSERT INTO onesport_players (room_id, player_id, player_data, created_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (room_id, player_id)
          DO UPDATE SET player_data = $3
        `;
        const pJson = JSON.stringify(player);
        await client.query(query, [normRoom, playerId, pJson]);
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres savePlayer error:', e.message);
      pgPool = null;
    }
  }

  return { success: true, provider: 'memory' };
}

async function deletePlayer(roomId = 'DEFAULT', playerId) {
  const normRoom = String(roomId).trim().toUpperCase() || 'DEFAULT';
  const pIdStr = String(playerId);
  const provider = getProvider();

  let memList = memoryStore.players.get(normRoom) || [];
  memoryStore.players.set(normRoom, memList.filter(p => String(p.id) !== pIdStr));

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = 'DELETE FROM onesport_players WHERE room_id = $1 AND player_id = $2';
        await client.query(query, [normRoom, pIdStr]);
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres deletePlayer error:', e.message);
      pgPool = null;
    }
  }

  return { success: true, provider: 'memory' };
}

// ── 5. OPERASI USERS & AUTHENTICATION ──
async function getUser(usernameOrEmail) {
  if (!usernameOrEmail) return null;
  const clean = String(usernameOrEmail).trim().toLowerCase();
  const provider = getProvider();

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const res = await client.query(
          'SELECT username, email, name, password, role FROM onesport_users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1',
          [clean]
        );
        if (res && res.rows && res.rows.length > 0) {
          return { ...res.rows[0], provider: 'postgres' };
        }
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getUser error:', e.message);
      pgPool = null;
    }
  }

  if (provider === 'kv') {
    try {
      const kv = getKvClient();
      if (kv) {
        let u = await kv.get('onesport:users:' + clean);
        if (!u && clean.includes('@')) {
          const direct = await kv.get('onesport:users:admin');
          if (direct && (direct.email || '').toLowerCase() === clean) {
            u = direct;
          }
        }
        if (u) return { ...u, provider: 'kv' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] KV getUser error:', e.message);
    }
  }

  // Memory fallback
  for (const [key, val] of memoryStore.users.entries()) {
    if (key === clean || (val.email && val.email.toLowerCase() === clean)) {
      return { ...val, provider: 'memory' };
    }
  }

  return null;
}

async function saveUser(userData) {
  if (!userData || !userData.username) return { success: false, message: 'Invalid user data' };
  const username = String(userData.username).trim().toLowerCase();
  const name = String(userData.name || username).trim();
  const password = String(userData.password || '').trim();
  const email = userData.email ? String(userData.email).trim().toLowerCase() : (username === 'admin' ? 'admin@onesport.co.id' : null);
  const role = (username === 'admin' || userData.role === 'host') ? 'host' : (userData.role || 'user');
  const provider = getProvider();

  const userObj = {
    username,
    email,
    name,
    password,
    role,
    updatedAt: Date.now()
  };

  memoryStore.users.set(username, userObj);

  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const query = `
          INSERT INTO onesport_users (username, email, name, password, role, updated_at)
          VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          ON CONFLICT (username)
          DO UPDATE SET email = COALESCE($2, onesport_users.email), name = $3, password = $4, role = $5, updated_at = CURRENT_TIMESTAMP
        `;
        await client.query(query, [username, email, name, password, role]);
        return { success: true, provider: 'postgres', user: { username, email, name, role } };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres saveUser error:', e.message);
      pgPool = null;
    }
  }

  if (provider === 'kv') {
    try {
      const kv = getKvClient();
      if (kv) {
        await kv.set('onesport:users:' + username, userObj);
        return { success: true, provider: 'kv', user: { username, email, name, role } };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] KV saveUser error:', e.message);
    }
  }

  return { success: true, provider: 'memory', user: { username, email, name, role } };
}

async function authenticateUser(usernameOrEmail, password) {
  if (!usernameOrEmail || !password) {
    return { success: false, message: 'Username dan password wajib diisi.' };
  }
  const cleanUname = String(usernameOrEmail).trim().toLowerCase();
  const cleanPass = String(password).trim();

  const user = await getUser(cleanUname);
  if (user) {
    if (user.password === cleanPass || (user.username === 'admin' && cleanPass === 'temanmainlebihdekat')) {
      return {
        success: true,
        user: {
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role
        },
        provider: user.provider || getProvider()
      };
    }
  }

  // Khusus admin: selalu izinkan kredensial default 'admin' / 'temanmainlebihdekat'
  if ((cleanUname === 'admin' || cleanUname === 'admin@onesport.co.id') && cleanPass === 'temanmainlebihdekat') {
    return {
      success: true,
      user: {
        username: 'admin',
        email: 'admin@onesport.co.id',
        name: 'Admin OneSport',
        role: 'host'
      },
      provider: getProvider()
    };
  }

  // Khusus user default:
  if (cleanUname === 'user' && cleanPass === 'user123') {
    return {
      success: true,
      user: {
        username: 'user',
        name: 'Pemain OneSport',
        role: 'user'
      },
      provider: getProvider()
    };
  }

  return { success: false, message: 'Akses ditolak: Username atau password salah!' };
}

async function getUsers() {
  const provider = getProvider();
  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const res = await client.query('SELECT username, email, name, role FROM onesport_users ORDER BY created_at ASC');
        if (res && res.rows) {
          return { users: res.rows, provider: 'postgres' };
        }
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getUsers error:', e.message);
      pgPool = null;
    }
  }

  const list = [];
  for (const val of memoryStore.users.values()) {
    list.push({ username: val.username, email: val.email, name: val.name, role: val.role });
  }
  return { users: list, provider: 'memory' };
}

async function checkHealth() {
  const provider = getProvider();
  if (provider === 'postgres') {
    try {
      const client = await getPgClient();
      if (client) {
        await ensurePgTables(client);
        const res = await client.query('SELECT 1 as alive');
        return {
          connected: Boolean(res && res.rows && res.rows.length > 0),
          provider: 'postgres',
          tablesReady: tablesInitialized
        };
      }
    } catch (e) {
      return {
        connected: false,
        provider: 'postgres',
        error: e.message
      };
    }
  }

  if (provider === 'kv') {
    try {
      const kv = getKvClient();
      if (kv) {
        await kv.set('onesport:health', 'ok', { ex: 60 });
        return {
          connected: true,
          provider: 'kv'
        };
      }
    } catch (e) {
      return {
        connected: false,
        provider: 'kv',
        error: e.message
      };
    }
  }

  return {
    connected: false,
    provider: 'memory',
    message: 'Running in in-memory fallback. Connect Vercel Postgres or KV in Vercel Storage.'
  };
}

module.exports = {
  getProvider,
  getPostgresConnectionString,
  getPgClient,
  ensurePgTables,
  getState,
  saveState,
  getPlayers,
  savePlayer,
  deletePlayer,
  getUser,
  saveUser,
  authenticateUser,
  getUsers,
  checkHealth
};
