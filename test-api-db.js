/**
 * ============================================================================
 * UNIT TESTS: ONESPORT BACKEND SERVERLESS API & DATABASE ADAPTER
 * Memverifikasi api/db.js, api/state.js, dan api/players.js
 * ============================================================================
 */
const assert = require('assert');
const db = require('./api/db.js');
const stateHandler = require('./api/state.js');
const playersHandler = require('./api/players.js');

let testCount = 0;
let passCount = 0;

function it(name, fn) {
  testCount++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        passCount++;
        console.log(`  ✓ ${name}`);
      }).catch(err => {
        console.error(`  ✗ ${name}`);
        console.error(err);
        process.exitCode = 1;
      });
    } else {
      passCount++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Helper mock req/res untuk serverless handler
function createMockReqRes({ method = 'GET', query = {}, body = null, headers = {} } = {}) {
  const req = {
    method,
    query,
    body,
    headers
  };
  const res = {
    statusCode: 200,
    headers: {},
    ended: false,
    body: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  return { req, res };
}

async function runTests() {
  console.log('\n=== RUNNING ONESPORT BACKEND SERVERLESS & DB TESTS ===\n');

  console.log('--- 1. Database Adapter In-Memory Provider & Operations ---');
  await it('getProvider mengembalikan memory saat tidak ada env database', () => {
    const provider = db.getProvider();
    assert.strictEqual(provider, 'memory');
  });

  await it('saveState dan getState menyimpan dan membaca state secara konsisten', async () => {
    const testRoom = 'TEST_ROOM_STATE_' + Date.now();
    const payload = {
      sessionTitle: 'Mabar Akbar DB Test',
      plannedRounds: 10,
      bPlayers: [{ id: 1, name: 'Budi' }],
      rev: 5
    };
    const saveRes = await db.saveState(testRoom, payload);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.provider, 'memory');

    const getRes = await db.getState(testRoom);
    assert.strictEqual(getRes.provider, 'memory');
    assert.deepStrictEqual(getRes.data, payload);
  });

  await it('CRUD pemain di database adapter (savePlayer, getPlayers, deletePlayer)', async () => {
    const testRoom = 'TEST_ROOM_PLAYERS_' + Date.now();
    const p1 = { id: 'p101', name: 'Agus', gender: 'L', role: 'Advance' };
    const p2 = { id: 'p102', name: 'Siti', gender: 'P', role: 'Pemula' };

    await db.savePlayer(testRoom, p1);
    await db.savePlayer(testRoom, p2);

    const list1 = await db.getPlayers(testRoom);
    assert.strictEqual(list1.players.length, 2);
    assert.strictEqual(list1.players[0].name, 'Agus');
    assert.strictEqual(list1.players[1].name, 'Siti');

    // Update player
    const p1Updated = { ...p1, name: 'Agus Santoso' };
    await db.savePlayer(testRoom, p1Updated);
    const list2 = await db.getPlayers(testRoom);
    assert.strictEqual(list2.players.length, 2);
    assert.strictEqual(list2.players[0].name, 'Agus Santoso');

    // Delete player
    const delRes = await db.deletePlayer(testRoom, 'p101');
    assert.strictEqual(delRes.success, true);
    const list3 = await db.getPlayers(testRoom);
    assert.strictEqual(list3.players.length, 1);
    assert.strictEqual(list3.players[0].id, 'p102');
  });

  console.log('\n--- 2. Serverless API Handler: /api/state ---');
  await it('/api/state merespon OPTIONS dengan header CORS lengkap', async () => {
    const { req, res } = createMockReqRes({ method: 'OPTIONS' });
    await stateHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers['access-control-allow-methods'].includes('GET'));
    assert.strictEqual(res.ended, true);
  });

  await it('/api/state GET mengembalikan state dari room', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      query: { roomId: 'API_TEST_ROOM' }
    });
    await stateHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.roomId, 'API_TEST_ROOM');
  });

  await it('/api/state POST menyimpan payload objek dan menangani string JSON', async () => {
    // Test dengan req.body string (raw text/json)
    const payload = { sessionTitle: 'Sesi Stringified JSON', rev: 1 };
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: JSON.stringify({ roomId: 'API_JSON_ROOM', payload })
    });
    await stateHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.roomId, 'API_JSON_ROOM');

    // Verifikasi dapat dibaca kembali
    const { req: getReq, res: getRes } = createMockReqRes({
      method: 'GET',
      query: { roomId: 'API_JSON_ROOM' }
    });
    await stateHandler(getReq, getRes);
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.body.data.sessionTitle, 'Sesi Stringified JSON');
  });

  console.log('\n--- 3. Serverless API Handler: /api/players ---');
  await it('/api/players menangani GET, POST, dan DELETE', async () => {
    const roomId = 'API_PLAYER_ROOM';
    // POST pemain baru
    const { req: pReq, res: pRes } = createMockReqRes({
      method: 'POST',
      body: { roomId, player: { id: 'play_99', name: 'Dewi', gender: 'P' } }
    });
    await playersHandler(pReq, pRes);
    assert.strictEqual(pRes.statusCode, 200);
    assert.strictEqual(pRes.body.success, true);
    assert.strictEqual(pRes.body.player.name, 'Dewi');

    // GET pemain
    const { req: gReq, res: gRes } = createMockReqRes({
      method: 'GET',
      query: { roomId }
    });
    await playersHandler(gReq, gRes);
    assert.strictEqual(gRes.statusCode, 200);
    assert.strictEqual(gRes.body.players.length, 1);
    assert.strictEqual(gRes.body.players[0].name, 'Dewi');

    // DELETE pemain
    const { req: dReq, res: dRes } = createMockReqRes({
      method: 'DELETE',
      query: { id: 'play_99', roomId }
    });
    await playersHandler(dReq, dRes);
    assert.strictEqual(dRes.statusCode, 200);
    assert.strictEqual(dRes.body.deletedId, 'play_99');

    // GET setelah hapus
    const { req: g2Req, res: g2Res } = createMockReqRes({
      method: 'GET',
      query: { roomId }
    });
    await playersHandler(g2Req, g2Res);
    assert.strictEqual(g2Res.body.players.length, 0);
  });

  await it('/api/players otomatis membuat player.id jika tidak disertakan', async () => {
    const roomId = 'API_AUTO_ID_ROOM';
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { roomId, name: 'Pemain Tanpa ID' }
    });
    await playersHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.player.id, 'player.id harus digenerate otomatis');
  });

  await it('Normalisasi roomId case-insensitive dan whitespace di /api/state dan /api/players', async () => {
    const { req: pReq, res: pRes } = createMockReqRes({
      method: 'POST',
      body: { roomId: '  mixEd_cAsE_rOOm  ', payload: { sessionTitle: 'Room Normalization Test' } }
    });
    await stateHandler(pReq, pRes);
    assert.strictEqual(pRes.statusCode, 200);
    assert.strictEqual(pRes.body.roomId, 'MIXED_CASE_ROOM');

    // Baca dengan lowercase
    const { req: gReq, res: gRes } = createMockReqRes({
      method: 'GET',
      query: { roomId: 'mixed_case_room' }
    });
    await stateHandler(gReq, gRes);
    assert.strictEqual(gRes.statusCode, 200);
    assert.strictEqual(gRes.body.data.sessionTitle, 'Room Normalization Test');
  });

  await it('Menolak payload state dan pemain yang tidak valid dengan status 400', async () => {
    // State invalid
    const { req: sReq, res: sRes } = createMockReqRes({
      method: 'POST',
      body: { roomId: 'INVALID_ROOM', payload: 'bukan_objek' }
    });
    await stateHandler(sReq, sRes);
    assert.strictEqual(sRes.statusCode, 400);

    // Player invalid (tanpa nama)
    const { req: pReq, res: pRes } = createMockReqRes({
      method: 'POST',
      body: { roomId: 'INVALID_ROOM', player: { gender: 'L' } }
    });
    await playersHandler(pReq, pRes);
    assert.strictEqual(pRes.statusCode, 400);
  });

  console.log('\n======================================================');
  console.log(`BACKEND TEST RESULTS: ${passCount} / ${testCount} Passed (${Math.round(passCount/testCount*100)}%)`);
  console.log('======================================================\n');
}

runTests();
