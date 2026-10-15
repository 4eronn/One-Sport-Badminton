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
const memoryStore = {
  states: new Map(),
  players: new Map()
};

function getProvider() {
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
    return 'postgres';
  }
  if ((process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) || process.env.KV_URL) {
    return 'kv';
  }
  return 'memory';
}

// ── 1. POSTGRES DRIVER ──
let pgPool = null;
let tablesInitialized = false;

async function getPgClient() {
  if (pgPool) return pgPool;

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  try {
    // Coba gunakan @vercel/postgres terlebih dahulu
    try {
      const vercelPg = require('@vercel/postgres');
      if (vercelPg && vercelPg.sql) {
        return vercelPg;
      }
    } catch (e) {}

    // Fallback ke standar node-postgres (pg)
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    return pgPool;
  } catch (err) {
    console.warn('[ONESPORT DB] Gagal inisialisasi driver Postgres:', err.message);
    return null;
  }
}

async function ensurePgTables(client) {
  if (tablesInitialized) return;
  const createSql = `
    CREATE TABLE IF NOT EXISTS onesport_state (
      room_id VARCHAR(100) PRIMARY KEY,
      state_data JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS onesport_players (
      room_id VARCHAR(100) NOT NULL,
      player_id VARCHAR(100) NOT NULL,
      player_data JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, player_id)
    );
  `;
  try {
    if (client.sql) {
      await client.sql.query(createSql);
    } else if (typeof client.query === 'function') {
      await client.query(createSql);
    }
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
        let res;
        if (client.sql) {
          res = await client.sql.query(query, [normRoom]);
        } else {
          res = await client.query(query, [normRoom]);
        }
        if (res && res.rows && res.rows.length > 0) {
          return { data: res.rows[0].state_data, provider: 'postgres' };
        }
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getState error:', e.message);
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
        if (client.sql) {
          await client.sql.query(query, [normRoom, stateJson]);
        } else {
          await client.query(query, [normRoom, stateJson]);
        }
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres saveState error:', e.message);
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
        let res;
        if (client.sql) {
          res = await client.sql.query(query, [normRoom]);
        } else {
          res = await client.query(query, [normRoom]);
        }
        if (res && res.rows) {
          const list = res.rows.map(r => r.player_data);
          return { players: list, provider: 'postgres' };
        }
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres getPlayers error:', e.message);
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
        if (client.sql) {
          await client.sql.query(query, [normRoom, playerId, pJson]);
        } else {
          await client.query(query, [normRoom, playerId, pJson]);
        }
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres savePlayer error:', e.message);
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
        if (client.sql) {
          await client.sql.query(query, [normRoom, pIdStr]);
        } else {
          await client.query(query, [normRoom, pIdStr]);
        }
        return { success: true, provider: 'postgres' };
      }
    } catch (e) {
      console.warn('[ONESPORT DB] Postgres deletePlayer error:', e.message);
    }
  }

  return { success: true, provider: 'memory' };
}

module.exports = {
  getProvider,
  getState,
  saveState,
  getPlayers,
  savePlayer,
  deletePlayer
};
