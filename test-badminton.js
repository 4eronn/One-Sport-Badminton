/**
 * Unit Test Suite for BadmintonService
 * Run with: node test-badminton.js
 */
const assert = require('assert');
const BadmintonService = require('./badminton-service.js');

const {
  PLAYER_STATUS,
  COURT_STATUS,
  REQUEST_STATUS,
  getPairKey,
  backfillPlayerStats,
  getEligibleQueue,
  prioritizeQueue,
  processCooldownsOnMatchEnd,
  submitPartnerRequest,
  cancelOrRejectPartnerRequest,
  splitFourIntoTeamsSmart,
  pickNextFourPlayersForMatch,
  createCourtProposal,
  approveCourtProposal,
  rejectCourtProposal,
  validateBadmintonScore,
  recordMatchFinished,
  editFinishedMatchScore,
  calculateStandings,
  addPlayerIncremental,
  removePlayerIncremental,
  getShuttlecockSummary,
  createDefaultShuttlecockInventory,
  resetBadmintonSession,
  calculateActivePeers,
  escapeHtml,
  validateAndNormalizeState
} = BadmintonService;

let testCount = 0;
let passCount = 0;

function it(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function itAsync(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n=== RUNNING ONESPORT BADMINTON SERVICE UNIT TESTS ===\n');

// ── TEST 1: Logika Antrian & Pemain Sedang/Baru Selesai Main Tidak Masuk Antrian (Fitur 1) ──
console.log('--- 1. Logika Antrian & Status Pemain (Fitur 1) ---');

it('Hanya pemain berstatus menunggu yang masuk daftar antrian', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.ISTIRAHAT, cooldown_remaining: 1 },
    { id: 4, name: 'Dodi', status: PLAYER_STATUS.TIDAK_AKTIF }
  ];

  const queue = getEligibleQueue(players);
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].id, 1);
});

it('Pemain yang baru selesai main mendapat cooldown (istirahat) dan keluar dari antrian', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.DI_LAPANGAN },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.MENUNGGU }
  ];

  const finishedPlayers = [players[0], players[1]];
  processCooldownsOnMatchEnd(players, finishedPlayers, 1);

  assert.strictEqual(players[0].status, PLAYER_STATUS.ISTIRAHAT);
  assert.strictEqual(players[0].cooldown_remaining, 1);
  assert.strictEqual(players[1].status, PLAYER_STATUS.ISTIRAHAT);

  // Cek antrian: Andi & Budi tidak boleh masuk
  const queue = getEligibleQueue(players);
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].name, 'Caca');
});

it('Cooldown pemain berkurang saat match lain selesai dan kembali ke antrian saat cooldown habis', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.ISTIRAHAT, cooldown_remaining: 1 },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.DI_LAPANGAN }
  ];

  // Match berikutnya selesai (Budi & Caca selesai)
  processCooldownsOnMatchEnd(players, [players[1], players[2]], 1);

  // Andi cooldownnya 1 - 1 = 0 -> status menjadi menunggu
  assert.strictEqual(players[0].status, PLAYER_STATUS.MENUNGGU);
  assert.strictEqual(players[0].cooldown_remaining, 0);

  // Budi & Caca sekarang yang istirahat
  assert.strictEqual(players[1].status, PLAYER_STATUS.ISTIRAHAT);
  assert.strictEqual(players[2].status, PLAYER_STATUS.ISTIRAHAT);
});

it('BUG-1: Deadlock cooldown dicegah: skenario 5, 6, 7 pemain/1 lapangan berjalan 6 match berturut-turut tanpa macet', () => {
  [5, 6, 7].forEach(numPlayers => {
    const players = Array.from({ length: numPlayers }, (_, i) => ({
      id: i + 1,
      name: `P${i + 1}`,
      status: PLAYER_STATUS.MENUNGGU,
      gender: 'L',
      role: 'Pemula',
      jumlah_main: 0
    }));
    const partnerHistory = {};
    const opponentHistory = {};

    for (let match = 1; match <= 6; match++) {
      const prop = createCourtProposal({
        courtNumber: 1,
        players,
        partnerHistory,
        opponentHistory,
        minPlays: 3
      });
      assert.strictEqual(prop.court.status, COURT_STATUS.MENUNGGU_ACC, `Match ${match} untuk ${numPlayers} pemain gagal dibuat`);
      const acc = approveCourtProposal(prop.court, players);
      assert.strictEqual(acc.success, true);
      const fin = recordMatchFinished({
        court: prop.court,
        scoreA: 21,
        scoreB: 19,
        winner: 'A',
        players,
        partnerHistory,
        opponentHistory,
        defaultCooldown: 1
      });
      assert.strictEqual(fin.success, true);
    }

    // Setiap pemain main minimal 3x dalam 6 match
    players.forEach(p => {
      assert.ok(p.jumlah_main >= 3, `Pemain ${p.name} pada ${numPlayers} pemain hanya main ${p.jumlah_main} kali (< 3)`);
    });
  });

  // Skenario 8 pemain/1 lapangan tidak melepaskan cooldown secara prematur
  const players8 = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: `P${i + 1}`,
    status: PLAYER_STATUS.MENUNGGU,
    gender: 'L',
    role: 'Pemula',
    jumlah_main: 0
  }));
  const pHist8 = {};
  const prop8_1 = createCourtProposal({ courtNumber: 1, players: players8, partnerHistory: pHist8, minPlays: 3 });
  approveCourtProposal(prop8_1.court, players8);
  recordMatchFinished({ court: prop8_1.court, scoreA: 21, scoreB: 18, winner: 'A', players: players8, partnerHistory: pHist8, defaultCooldown: 1 });
  const prop8_2 = createCourtProposal({ courtNumber: 1, players: players8, partnerHistory: pHist8, minPlays: 3 });
  assert.strictEqual(prop8_2.court.status, COURT_STATUS.MENUNGGU_ACC);
  assert.strictEqual(!!prop8_2.court.cooldownReleased, false);
});

// ── TEST 2: Fitur Request Rekan Tim (Maksimal 1x) (Fitur 2) ──
console.log('\n--- 2. Request Rekan Tim (Fitur 2) ---');

it('Pemain dapat mengajukan request rekan tim jika keduanya menunggu', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, request_used: false }
  ];
  const requests = [];

  const res = submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests: requests,
    partnerHistory: {}
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(players[0].request_used, true);
});

it('Request gagal jika kuota pemain pemohon sudah habis (maksimal 1x)', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: true },
    { id: 2, name: 'Caca', status: PLAYER_STATUS.MENUNGGU, request_used: false }
  ];
  const requests = [];

  const res = submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests: requests,
    partnerHistory: {}
  });

  assert.strictEqual(res.success, false);
  assert.match(res.message, /kuota/i);
});

it('Request gagal jika salah satu pemain sedang di lapangan atau istirahat', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN, request_used: false }
  ];
  const requests = [];

  const res = submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests: requests,
    partnerHistory: {}
  });

  assert.strictEqual(res.success, false);
  assert.match(res.message, /menunggu/i);
});

it('Memberikan peringatan ke host jika pasangan request pernah berpasangan sebelumnya', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, request_used: false }
  ];
  const requests = [];
  const partnerHistory = { [getPairKey(1, 2)]: 1 };

  const res = submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests: requests,
    partnerHistory
  });

  assert.strictEqual(res.success, true);
  assert.ok(res.warning !== null);
  assert.match(res.warning, /sudah pernah berpasangan/i);
});

it('BUG-3: Target request dihapus -> request CANCELLED dan kuota pemohon kembali', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.MENUNGGU, request_used: false }
  ];
  const partnerRequests = [];

  submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests
  });

  assert.strictEqual(players[0].request_used, true);
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.APPROVED);

  // Target (Budi, id: 2) dihapus
  removePlayerIncremental(2, players, [], partnerRequests);

  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.CANCELLED);
  assert.strictEqual(players[0].request_used, false, 'Kuota request pemohon harus kembali false');

  // Pemohon bisa request pemain lain (Caca, id: 3)
  const res2 = submitPartnerRequest({
    requesterId: 1,
    targetId: 3,
    players,
    partnerRequests
  });
  assert.strictEqual(res2.success, true);
});

it('BUG-3: Target ditandai leave_after_match -> request CANCELLED saat match selesai dan kuota pemohon kembali', () => {
  const p1 = { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false };
  const p2 = { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN, leave_after_match: true };
  const players = [p1, p2];
  const partnerRequests = [
    {
      id: 101,
      requesterId: 1,
      targetId: 2,
      status: REQUEST_STATUS.APPROVED
    }
  ];
  p1.request_used = true;

  processCooldownsOnMatchEnd(players, [p2], 1, partnerRequests);

  assert.strictEqual(p2.status, PLAYER_STATUS.TIDAK_AKTIF);
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.CANCELLED);
  assert.strictEqual(p1.request_used, false);
});

it('BUG-3: Request rekan tim menolak pasangan role Intermediate & Advance', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, role: 'Advance', request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, role: 'Intermadiate', request_used: false }
  ];
  const partnerRequests = [];

  const res = submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests
  });

  assert.strictEqual(res.success, false);
  assert.match(res.message, /Intermediate dan Advance/i);
});

it('BUG-3: Request rekan tim menolak jika target sudah memiliki request aktif lain', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, request_used: false },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.MENUNGGU, request_used: false }
  ];
  const partnerRequests = [];

  // Andi request Budi
  const res1 = submitPartnerRequest({ requesterId: 1, targetId: 2, players, partnerRequests });
  assert.strictEqual(res1.success, true);

  // Caca juga coba request Budi
  const res2 = submitPartnerRequest({ requesterId: 3, targetId: 2, players, partnerRequests });
  assert.strictEqual(res2.success, false);
  assert.match(res2.message, /sudah memiliki request pasangan aktif/i);
});

it('BUG-3: pickNextFourPlayersForMatch membatalkan request jika pemain target tidak aktif', () => {
  const p1 = { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, request_used: true };
  const p2 = { id: 2, name: 'Budi', status: PLAYER_STATUS.TIDAK_AKTIF, is_deleted: true };
  const p3 = { id: 3, name: 'Caca', status: PLAYER_STATUS.MENUNGGU };
  const p4 = { id: 4, name: 'Dedi', status: PLAYER_STATUS.MENUNGGU };
  const p5 = { id: 5, name: 'Eko', status: PLAYER_STATUS.MENUNGGU };
  const players = [p1, p2, p3, p4, p5];
  const queue = [p1, p3, p4, p5];
  const partnerRequests = [
    { id: 1, requesterId: 1, targetId: 2, status: REQUEST_STATUS.APPROVED }
  ];

  const selected = pickNextFourPlayersForMatch(queue, partnerRequests, {}, players);
  assert.strictEqual(selected.length, 4);
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.CANCELLED);
  assert.strictEqual(p1.request_used, false);
});

it('BUG-3/Fix: Request rekan tim TIDAK menjadi COMPLETED saat match di-ACC, dan tetap APPROVED jika match ditolak/dikosongkan', () => {
  const p1 = { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, gender: 'L', role: 'Pemula', request_used: false };
  const p2 = { id: 2, name: 'Budi', status: PLAYER_STATUS.MENUNGGU, gender: 'L', role: 'Pemula', request_used: false };
  const p3 = { id: 3, name: 'Caca', status: PLAYER_STATUS.MENUNGGU, gender: 'L', role: 'Pemula', request_used: false };
  const p4 = { id: 4, name: 'Dedi', status: PLAYER_STATUS.MENUNGGU, gender: 'L', role: 'Pemula', request_used: false };
  const players = [p1, p2, p3, p4];
  const partnerRequests = [];

  submitPartnerRequest({
    requesterId: 1,
    targetId: 2,
    players,
    partnerRequests
  });

  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.APPROVED);

  // Buat usulan match
  const prop = createCourtProposal({
    courtNumber: 1,
    players,
    partnerRequests
  });
  assert.strictEqual(prop.court.status, COURT_STATUS.MENUNGGU_ACC);

  // ACC proposal
  const accRes = approveCourtProposal(prop.court, players, partnerRequests);
  assert.strictEqual(accRes.success, true);
  assert.strictEqual(prop.court.status, COURT_STATUS.SEDANG_MAIN);

  // Request tidak boleh langsung COMPLETED saat match baru dimulai / ACC!
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.APPROVED, 'Status request harus tetap APPROVED selama match belum selesai');

  // Skenario: Host membatalkan / mengosongkan lapangan di tengah jalan (clearCourt / rejectCourtProposal)
  rejectCourtProposal(prop.court, players, partnerRequests);
  assert.strictEqual(prop.court.status, COURT_STATUS.KOSONG);
  assert.strictEqual(p1.status, PLAYER_STATUS.MENUNGGU);
  assert.strictEqual(p2.status, PLAYER_STATUS.MENUNGGU);

  // Request masih tetap APPROVED (tidak hangus dan tidak selesai prematur)
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.APPROVED, 'Status request harus tetap APPROVED agar bisa dipasangkan di usulan berikutnya');

  // Usulkan match kembali -> pasangan 1 & 2 harus dipasangkan kembali
  const prop2 = createCourtProposal({
    courtNumber: 1,
    players,
    partnerRequests
  });
  assert.strictEqual(prop2.court.status, COURT_STATUS.MENUNGGU_ACC);
  const inTeamA = prop2.court.teamA.some(p => p.id === 1) && prop2.court.teamA.some(p => p.id === 2);
  const inTeamB = prop2.court.teamB.some(p => p.id === 1) && prop2.court.teamB.some(p => p.id === 2);
  assert.strictEqual(inTeamA || inTeamB, true, 'Andi dan Budi harus tetap dipasangkan bersama');

  // ACC dan selesaikan match dengan skor resmi
  approveCourtProposal(prop2.court, players, partnerRequests);
  const finRes = recordMatchFinished({
    court: prop2.court,
    scoreA: 21,
    scoreB: 15,
    winner: 'A',
    players,
    partnerRequests
  });
  assert.strictEqual(finRes.success, true);

  // BARU di sini request resmi menjadi COMPLETED!
  assert.strictEqual(partnerRequests[0].status, REQUEST_STATUS.COMPLETED, 'Request harus resmi COMPLETED setelah match selesai');
});

// ── TEST 3: Tambah/Kurangi Pemain Tanpa Reset Data (Fitur 3) ──
console.log('\n--- 3. Tambah & Kurangi Pemain Tanpa Reset (Fitur 3) ---');

it('Tambah pemain baru langsung berstatus menunggu tanpa mereset data', () => {
  const players = [{ id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 2 }];
  const newP = addPlayerIncremental(players, { name: 'Zaki', gender: 'L', role: 'Pemula' });

  assert.strictEqual(players.length, 2);
  assert.strictEqual(newP.status, PLAYER_STATUS.MENUNGGU);
  assert.strictEqual(newP.jumlah_main, 0);
  assert.strictEqual(players[0].jumlah_main, 2); // Andi tidak ter-reset
});

it('Q-7: addPlayerIncremental membatasi nama 40 karakter, meratakan spasi ganda, dan memberi peringatan pada nama duplikat tanpa memblokir', () => {
  const players = [
    { id: 1, name: 'Budi Santoso', status: PLAYER_STATUS.MENUNGGU }
  ];

  // 1. Spasi ganda internal dan trim
  const p1 = addPlayerIncremental(players, { name: '   Agus    Prabowo   Subianto   ' });
  assert.strictEqual(p1.name, 'Agus Prabowo Subianto');

  // 2. Batas 40 karakter
  const longName = 'A'.repeat(55);
  const p2 = addPlayerIncremental(players, { name: longName });
  assert.strictEqual(p2.name.length, 40);

  // 3. Nama duplikat: tidak memblokir (masuk antrian) tapi memberi peringatan
  const pDup = addPlayerIncremental(players, { name: '  budi   santoso  ' });
  assert.strictEqual(players.length, 4, 'pemain duplikat tetap ditambahkan (tidak diblokir)');
  assert.strictEqual(pDup.name, 'budi santoso');
  assert.strictEqual(pDup.isDuplicate, true);
  assert.ok(pDup.warning && pDup.warning.includes('budi santoso'));
});

it('Pemain menunggu yang dihapus diubah statusnya menjadi tidak_aktif (soft delete)', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 1 }
  ];

  const res = removePlayerIncremental(1, players, []);
  assert.strictEqual(res.success, true);
  assert.strictEqual(players[0].status, PLAYER_STATUS.TIDAK_AKTIF);
  assert.strictEqual(players[0].is_deleted, true);

  // Tidak masuk antrian
  const queue = getEligibleQueue(players);
  assert.strictEqual(queue.length, 0);
});

it('Pemain di lapangan yang dihapus ditandai leave_after_match', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.DI_LAPANGAN }
  ];
  const activeCourts = [
    { status: 'sedang_main', teamA: [players[0]], teamB: [] }
  ];

  const res = removePlayerIncremental(1, players, activeCourts);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.mode, 'leave_after_match');
  assert.strictEqual(players[0].leave_after_match, true);
  assert.strictEqual(players[0].status, PLAYER_STATUS.DI_LAPANGAN); // Masih main
});

// ── TEST 4: Input Skor Langsung & Klasemen Real-Time (Fitur 4) ──
console.log('\n--- 4. Input Skor & Klasemen (Fitur 4) ---');

it('Validasi skor bulu tangkis menolak seri atau angka negatif', () => {
  const v1 = validateBadmintonScore(21, 21, 'A');
  assert.strictEqual(v1.valid, false);

  const v2 = validateBadmintonScore(-5, 21, 'B');
  assert.strictEqual(v2.valid, false);

  const v3 = validateBadmintonScore(21, 19, 'A');
  assert.strictEqual(v3.valid, true);
});

it('Q-1: Validasi skor menolak non-integer, input kosong, dan skor di atas batas (99)', () => {
  // Input kosong
  assert.strictEqual(validateBadmintonScore(null, 21).valid, false);
  assert.strictEqual(validateBadmintonScore(21, '').valid, false);
  assert.strictEqual(validateBadmintonScore('  ', 21).valid, false);
  assert.strictEqual(validateBadmintonScore(undefined, 21).valid, false);

  // Non-integer
  assert.strictEqual(validateBadmintonScore(21.5, 18).valid, false);
  assert.strictEqual(validateBadmintonScore('abc', 21).valid, false);

  // Di atas batas default (99)
  assert.strictEqual(validateBadmintonScore(100, 21).valid, false);
  assert.strictEqual(validateBadmintonScore(21, 105).valid, false);
  assert.strictEqual(validateBadmintonScore(99, 97).valid, true);
});

it('Q-1: Mode Aturan Skor Resmi (officialRules) menegakkan pemenang >= 21, selisih >= 2, dan maks 30', () => {
  const opts = { officialRules: true };

  // Valid official scores
  assert.strictEqual(validateBadmintonScore(21, 19, null, opts).valid, true);
  assert.strictEqual(validateBadmintonScore(21, 0, null, opts).valid, true);
  assert.strictEqual(validateBadmintonScore(24, 22, null, opts).valid, true);
  assert.strictEqual(validateBadmintonScore(30, 29, null, opts).valid, true, '30-29 sudden death harus valid');

  // Pemenang < 21
  assert.strictEqual(validateBadmintonScore(15, 10, null, opts).valid, false, 'Skor 15-10 ditolak di aturan resmi');
  assert.strictEqual(validateBadmintonScore(20, 18, null, opts).valid, false, 'Pemenang 20 ditolak');

  // Selisih < 2 (belum deuce selesai)
  assert.strictEqual(validateBadmintonScore(21, 20, null, opts).valid, false, '21-20 belum selisih 2');
  assert.strictEqual(validateBadmintonScore(25, 24, null, opts).valid, false, '25-24 belum selisih 2');

  // Melebihi batas maksimal 30
  assert.strictEqual(validateBadmintonScore(31, 29, null, opts).valid, false, 'Skor > 30 ditolak');

  // Mode casual (default / tanpa officialRules) tetap fleksibel
  assert.strictEqual(validateBadmintonScore(15, 10).valid, true, 'Skor 15-10 valid di mabar santai');
});

it('Menyimpan skor match langsung menghitung klasemen secara inkremental', () => {
  const p1 = { id: 1, name: 'Andi', status: PLAYER_STATUS.DI_LAPANGAN, jumlah_main: 0 };
  const p2 = { id: 2, name: 'Budi', status: PLAYER_STATUS.DI_LAPANGAN, jumlah_main: 0 };
  const p3 = { id: 3, name: 'Caca', status: PLAYER_STATUS.DI_LAPANGAN, jumlah_main: 0 };
  const p4 = { id: 4, name: 'Dodi', status: PLAYER_STATUS.DI_LAPANGAN, jumlah_main: 0 };
  const players = [p1, p2, p3, p4];

  const court = {
    courtNumber: 1,
    status: COURT_STATUS.SEDANG_MAIN,
    teamA: [p1, p2],
    teamB: [p3, p4]
  };

  const schedule = [{ roundNumber: 1, courts: [court] }];
  const partnerHistory = {};
  const opponentHistory = {};

  const recordRes = recordMatchFinished({
    court,
    scoreA: 21,
    scoreB: 15,
    winner: 'A',
    players,
    partnerHistory,
    opponentHistory,
    defaultCooldown: 1
  });

  assert.strictEqual(recordRes.success, true);
  assert.strictEqual(p1.jumlah_main, 1);
  assert.strictEqual(p3.jumlah_main, 1);

  // Hitung klasemen
  const standings = calculateStandings(players, schedule);
  assert.strictEqual(standings[0].id, 1); // Andi (Win 1, Diff +6)
  assert.strictEqual(standings[0].wins, 1);
  assert.strictEqual(standings[0].diff, 6);
  assert.strictEqual(standings[3].wins, 0);
  assert.strictEqual(standings[3].diff, -6);
});

it('BUG-2: Skor 21-0 dibuka lalu diedit/disimpan tanpa perubahan tetap 21-0', () => {
  const court = {
    status: COURT_STATUS.FINISHED,
    scoreA: 21,
    scoreB: 0,
    winner: 'A',
    teamA: [{ id: 1 }, { id: 2 }],
    teamB: [{ id: 3 }, { id: 4 }]
  };
  const initialValueA = court.scoreA ?? 21;
  const initialValueB = court.scoreB ?? 18;
  assert.strictEqual(initialValueA, 21);
  assert.strictEqual(initialValueB, 0, 'Skor 0 tidak boleh di-fallback menjadi 18');

  const res = editFinishedMatchScore({
    court,
    newScoreA: initialValueA,
    newScoreB: initialValueB,
    newWinner: 'A'
  });
  assert.strictEqual(res.success, true);
  assert.strictEqual(court.scoreA, 21);
  assert.strictEqual(court.scoreB, 0);
});

it('BUG-2/Edit: Mengedit skor membalik pemenang dan memperbarui klasemen tanpa error konflik winner', () => {
  const p1 = { id: 1, name: 'Andi' };
  const p2 = { id: 2, name: 'Budi' };
  const p3 = { id: 3, name: 'Caca' };
  const p4 = { id: 4, name: 'Dedi' };
  const players = [p1, p2, p3, p4];

  const court = {
    courtNumber: 1,
    status: COURT_STATUS.FINISHED,
    scoreA: 21,
    scoreB: 18,
    winner: 'A',
    teamA: [p1, p2],
    teamB: [p3, p4]
  };

  const schedule = [{ roundNumber: 1, courts: [], finishedCourts: [court] }];

  // Klasemen awal: Tim A menang (21-18)
  const st1 = calculateStandings(players, schedule);
  assert.strictEqual(st1[0].id, 1);
  assert.strictEqual(st1[0].wins, 1);
  assert.strictEqual(st1[0].diff, 3);
  assert.strictEqual(st1[2].wins, 0);
  assert.strictEqual(st1[2].diff, -3);

  // Edit skor: Tim B menang (15-21), sekalipun radio winner usang ('A') terkirim
  const res = editFinishedMatchScore({
    court,
    newScoreA: 15,
    newScoreB: 21,
    newWinner: 'A'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(court.scoreA, 15);
  assert.strictEqual(court.scoreB, 21);
  assert.strictEqual(court.winner, 'B', 'Pemenang harus otomatis berbalik menjadi B');

  // Klasemen setelah edit: Tim B sekarang di atas (1 win, diff +6)
  const st2 = calculateStandings(players, schedule);
  assert.strictEqual(st2[0].id, 3);
  assert.strictEqual(st2[0].wins, 1);
  assert.strictEqual(st2[0].diff, 6);
  assert.strictEqual(st2[2].id, 1);
  assert.strictEqual(st2[2].wins, 0);
  assert.strictEqual(st2[2].diff, -6);
});

it('BUG-9: Skenario 2 pemain seri menang dengan H2H berbeda (H2H diprioritaskan sebelum Diff)', () => {
  const p1 = { id: 1, name: 'Andi' };
  const p2 = { id: 2, name: 'Budi' };
  const p3 = { id: 3, name: 'Caca' };
  const p4 = { id: 4, name: 'Dedi' };
  const p5 = { id: 5, name: 'Eko' };
  const players = [p1, p2, p3, p4, p5];

  // Eko (P5) menang semua match (3 win) -> Juara 1 bersih
  // Match 1: Eko (P5) vs Caca (P3) -> Eko menang 21-10
  // Match 2: Eko (P5) vs Dedi (P4) -> Eko menang 21-10
  // Match 3: Eko (P5) vs Andi (P1) -> Eko menang 21-18 (Andi skor 18, diff -3)
  // Match 4: Andi (P1) vs Budi (P2) -> Andi menang 21-19 (H2H Andi > Budi, diff Andi +2, Budi -2)
  // Match 5: Budi (P2) vs Caca (P3) -> Budi menang 21-15 (Budi diff +6)
  // Total Win:
  // Eko: 3 win
  // Andi (P1): 1 win (diff -1, total poin 39)
  // Budi (P2): 1 win (diff +4, total poin 40)
  // Caca (P3): 0 win
  // Dedi (P4): 0 win
  const schedule = [
    {
      roundNumber: 1,
      courts: [],
      finishedCourts: [
        { courtNumber: 1, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 10, winner: 'A', teamA: [p5], teamB: [p3] },
        { courtNumber: 2, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 10, winner: 'A', teamA: [p5], teamB: [p4] },
        { courtNumber: 3, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 18, winner: 'A', teamA: [p5], teamB: [p1] },
        { courtNumber: 4, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 19, winner: 'A', teamA: [p1], teamB: [p2] },
        { courtNumber: 5, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 15, winner: 'A', teamA: [p2], teamB: [p3] }
      ]
    }
  ];

  const standings = calculateStandings(players, schedule);
  // P5 juara 1 (3 win).
  // Tepat 2 pemain seri di 1 win: P1 dan P2.
  // Walaupun P2 memiliki total poin lebih banyak (40 vs 39) dan diff lebih besar (+4 vs -1),
  // aturan resmi (README) menegaskan H2H didahulukan saat tepat 2 pemain seri!
  // P1 mengalahkan P2 langsung (Match 4), maka P1 harus di atas P2.
  assert.strictEqual(standings[0].id, 5, 'Eko harus peringkat 1 (3 win)');
  assert.strictEqual(standings[1].id, 1, 'P1 harus di atas P2 karena unggul H2H langsung');
  assert.strictEqual(standings[2].id, 2, 'P2 harus berada di bawah P1');
  assert.ok(standings[1].tieBreakNote.includes('H2H'), 'Catatan tie-break P1 harus mencantumkan H2H');
});

it('BUG-9: Skenario 3 pemain seri (H2H tidak dipakai, total poin menentukan urutan)', () => {
  const p1 = { id: 1, name: 'Andi' };
  const p2 = { id: 2, name: 'Budi' };
  const p3 = { id: 3, name: 'Caca' };
  const p4 = { id: 4, name: 'Dedi' };
  const players = [p1, p2, p3, p4];

  // Lingkaran H2H 3 arah (rock-paper-scissors):
  // Andi kalahkan Budi (21-10)
  // Budi kalahkan Caca (21-10)
  // Caca kalahkan Andi (21-10)
  // Dedi kalah semua
  // P1 total poin: 21 + 10 = 31
  // Tambahkan match lain agar total poin berbeda:
  // Match 4: Caca vs Dedi (25-20) -> Caca menang, sekarang Caca 2 menang
  // Agar 3 pemain sama-sama 1 menang:
  // P1: main 2x, 1 menang (21-10 vs P2), 1 kalah (20-22 vs P4). Total poin: 41
  // P2: main 2x, 1 menang (21-10 vs P3), 1 kalah (10-21 vs P1). Total poin: 31
  // P3: main 2x, 1 menang (21-10 vs P1), 1 kalah (10-21 vs P2). Total poin: 31, tapi beri skor 15-21 jadi Total poin: 36
  const schedule = [
    {
      roundNumber: 1,
      courts: [],
      finishedCourts: [
        { courtNumber: 1, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 10, winner: 'A', teamA: [p1], teamB: [p2] },
        { courtNumber: 2, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 15, winner: 'A', teamA: [p2], teamB: [p3] },
        { courtNumber: 3, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 19, winner: 'A', teamA: [p3], teamB: [p1] }
      ]
    }
  ];
  // Di sini P1, P2, P3 masing-masing 1 menang.
  // P1 total poin: 21 + 19 = 40
  // P2 total poin: 10 + 21 = 31
  // P3 total poin: 15 + 21 = 36
  // Karena 3 pemain seri menang, H2H tidak dipakai, total poin menentukan urutan: P1 (40) -> P3 (36) -> P2 (31)
  const standings = calculateStandings(players, schedule);
  assert.strictEqual(standings[0].id, 1, 'P1 harus pertama (40 poin)');
  assert.strictEqual(standings[1].id, 3, 'P3 harus kedua (36 poin)');
  assert.strictEqual(standings[2].id, 2, 'P2 harus ketiga (31 poin)');
  assert.ok(standings[0].tieBreakNote.includes('Total Poin') || standings[1].tieBreakNote.includes('Total Poin'));
});

it('BUG-9: Skenario titles menentukan urutan saat menang, H2H, dan total poin sama', () => {
  const p1 = { id: 1, name: 'Andi', titles: 0 };
  const p2 = { id: 2, name: 'Budi', titles: 2 };
  const p3 = { id: 3, name: 'Caca', titles: 0 };
  const players = [p1, p2, p3];

  // P1 vs P3 (21-10) -> P1 menang (21 poin)
  // P2 vs P3 (21-10) -> P2 menang (21 poin)
  // P1 dan P2 tidak saling bertanding (H2H = 0), wins sama (1), totalScore sama (21), diff sama (+11).
  const schedule = [
    {
      roundNumber: 1,
      courts: [],
      finishedCourts: [
        { courtNumber: 1, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 10, winner: 'A', teamA: [p1], teamB: [p3] },
        { courtNumber: 2, status: COURT_STATUS.FINISHED, scoreA: 21, scoreB: 10, winner: 'A', teamA: [p2], teamB: [p3] }
      ]
    }
  ];

  const standings = calculateStandings(players, schedule);
  assert.strictEqual(standings[0].id, 2, 'P2 harus unggul karena memiliki 2 gelar juara (titles)');
  assert.strictEqual(standings[1].id, 1, 'P1 harus kedua karena memiliki 0 gelar');
  assert.ok(standings[0].tieBreakNote.includes('Gelar Juara'));
});

// ── TEST 5: Jadwal Masuk Lapangan Harus Di-ACC Host (Fitur 5) ──
console.log('\n--- 5. Workflow ACC Host (Fitur 5) ---');

it('Sistem membuat usulan match berstatus menunggu_acc tanpa auto-masuk lapangan', () => {
  const players = [
    { id: 1, name: 'P1', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 },
    { id: 2, name: 'P2', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 },
    { id: 3, name: 'P3', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 },
    { id: 4, name: 'P4', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 }
  ];

  const prop = createCourtProposal({
    courtNumber: 1,
    courtName: 'Lapangan 1',
    players
  });

  assert.strictEqual(prop.court.status, COURT_STATUS.MENUNGGU_ACC);
  // Status pemain belum di_lapangan
  assert.strictEqual(players[0].status, PLAYER_STATUS.MENUNGGU);
});

it('Pemain baru berstatus di_lapangan setelah Host menekan ACC', () => {
  const p1 = { id: 1, name: 'P1', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 };
  const p2 = { id: 2, name: 'P2', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 };
  const p3 = { id: 3, name: 'P3', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 };
  const p4 = { id: 4, name: 'P4', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 };
  const players = [p1, p2, p3, p4];

  const court = {
    courtNumber: 1,
    status: COURT_STATUS.MENUNGGU_ACC,
    teamA: [p1, p2],
    teamB: [p3, p4]
  };

  const accRes = approveCourtProposal(court, players, []);
  assert.strictEqual(accRes.success, true);
  assert.strictEqual(court.status, COURT_STATUS.SEDANG_MAIN);
  assert.strictEqual(p1.status, PLAYER_STATUS.DI_LAPANGAN);
  assert.strictEqual(p4.status, PLAYER_STATUS.DI_LAPANGAN);
});

it('Jika Host menolak usulan, pemain tetap berstatus menunggu dan lapangan kosong', () => {
  const p1 = { id: 1, name: 'P1', status: PLAYER_STATUS.MENUNGGU };
  const p2 = { id: 2, name: 'P2', status: PLAYER_STATUS.MENUNGGU };
  const p3 = { id: 3, name: 'P3', status: PLAYER_STATUS.MENUNGGU };
  const p4 = { id: 4, name: 'P4', status: PLAYER_STATUS.MENUNGGU };
  const players = [p1, p2, p3, p4];

  const court = {
    courtNumber: 1,
    status: COURT_STATUS.MENUNGGU_ACC,
    teamA: [p1, p2],
    teamB: [p3, p4]
  };

  const rejRes = rejectCourtProposal(court, players);
  assert.strictEqual(rejRes.success, true);
  assert.strictEqual(court.status, COURT_STATUS.KOSONG);
  assert.strictEqual(p1.status, PLAYER_STATUS.MENUNGGU);
});

// ── TEST 6: Monitoring Kok Per Lapangan (Fitur 6) ──
console.log('\n--- 6. Monitoring Kok (Fitur 6) ---');

it('Mencatat penggunaan kok baru dan bekas serta update sisa stok', () => {
  const inv = createDefaultShuttlecockInventory(24, 12);
  const court1 = {
    courtNumber: 1,
    shuttlecocks: { baru: 2, bekas_layak: 1, bekas_dihasilkan: 1 }
  };
  const court2 = {
    courtNumber: 2,
    shuttlecocks: { baru: 1, bekas_layak: 2, bekas_dihasilkan: 0 }
  };
  const schedule = [{ courts: [court1, court2] }];

  const summary = getShuttlecockSummary(schedule, inv);
  assert.strictEqual(summary.terpakaiBaru, 3);
  assert.strictEqual(summary.terpakaiBekas, 3);
  assert.strictEqual(summary.sisaBaru, 21); // 24 - 3
  assert.strictEqual(summary.sisaBekas, 10); // 12 - 3 + 1
});

it('Q-2: recordMatchFinished tidak memutasi inventory langsung, clamp input kok >= 0 dan bulat, re-record tidak duplikasi ringkasan', () => {
  const inv = createDefaultShuttlecockInventory(20, 10);
  // Default baru tidak boleh memiliki counter terpakaiBaru dll
  assert.strictEqual('terpakaiBaru' in inv, false, 'stok default baru tidak menyimpan counter terpakaiBaru');

  const court = {
    courtNumber: 1,
    teamA: [{ id: 1, name: 'P1' }, { id: 2, name: 'P2' }],
    teamB: [{ id: 3, name: 'P3' }, { id: 4, name: 'P4' }],
    status: 'sedang_main'
  };

  const schedule = [{ courts: [court], finishedCourts: [] }];

  // Input dengan bilangan negatif dan desimal harus diclamp ke integer >= 0
  const res1 = recordMatchFinished({
    court,
    scoreA: 21,
    scoreB: 15,
    winner: 'A',
    players: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    shuttlecocks: { baru: -2, bekas_layak: 2.8, bekas_dihasilkan: '1' },
    inventory: inv
  });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(court.shuttlecocks.baru, 0, 'kok baru negatif diclamp ke 0');
  assert.strictEqual(court.shuttlecocks.bekas_layak, 2, 'kok bekas 2.8 dibulatkan ke bawah');
  assert.strictEqual(court.shuttlecocks.bekas_dihasilkan, 1);
  assert.strictEqual('terpakaiBaru' in inv, false, 'inventory tidak dimutasi langsung oleh recordMatchFinished');

  // Ringkasan dari schedule
  const sum1 = getShuttlecockSummary(schedule, inv);
  assert.strictEqual(sum1.terpakaiBaru, 0);
  assert.strictEqual(sum1.terpakaiBekas, 2);
  assert.strictEqual(sum1.sisaBaru, 20);
  assert.strictEqual(sum1.sisaBekas, 9); // 10 - 2 + 1

  // Re-record / edit skor match yang sama
  const res2 = recordMatchFinished({
    court,
    scoreA: 21,
    scoreB: 18,
    winner: 'A',
    players: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    shuttlecocks: { baru: 1, bekas_layak: 2, bekas_dihasilkan: 1 },
    inventory: inv
  });
  assert.strictEqual(res2.success, true);
  assert.strictEqual('terpakaiBaru' in inv, false);

  const sum2 = getShuttlecockSummary(schedule, inv);
  assert.strictEqual(sum2.terpakaiBaru, 1);
  assert.strictEqual(sum2.terpakaiBekas, 2);
  assert.strictEqual(sum2.sisaBaru, 19);
  assert.strictEqual(sum2.sisaBekas, 9);
});


// ── TEST 7: Minimal Main 3x Per Pemain (Fitur 7) ──
console.log('\n--- 7. Minimal Main 3x Per Pemain (Fitur 7) ---');

it('Antrian memprioritaskan pemain dengan jumlah_main < 3 dibanding yang sudah >= 3', () => {
  const players = [
    { id: 1, name: 'A', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 3 },
    { id: 2, name: 'B', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 0 },
    { id: 3, name: 'C', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 2 },
    { id: 4, name: 'D', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 4 }
  ];

  const sorted = prioritizeQueue(players, 3);
  assert.strictEqual(sorted[0].name, 'B'); // 0x main
  assert.strictEqual(sorted[1].name, 'C'); // 2x main
  assert.strictEqual(sorted[2].name, 'A'); // 3x main
  assert.strictEqual(sorted[3].name, 'D'); // 4x main
});

it('Q-3: prioritizeQueue melakukan tie-break berdasarkan waitingSince lebih dulu sebelum id', () => {
  const p1 = { id: 10, name: 'Pemain Baru Antri', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 1, waitingSince: 2000 };
  const p2 = { id: 50, name: 'Pemain Lama Nunggu', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 1, waitingSince: 1000 };
  const p3 = { id: 5, name: 'Pemain ID Kecil Sama Waiting', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 1, waitingSince: 3000 };
  const p4 = { id: 8, name: 'Pemain ID Besar Sama Waiting', status: PLAYER_STATUS.MENUNGGU, jumlah_main: 1, waitingSince: 3000 };

  const sorted = prioritizeQueue([p1, p2, p3, p4], 3);
  // p2 waitingSince 1000 harus pertama meski id 50 > 10
  assert.strictEqual(sorted[0].id, 50, 'p2 menunggu lebih lama (waitingSince 1000) harus didahulukan');
  assert.strictEqual(sorted[1].id, 10, 'p1 waitingSince 2000');
  assert.strictEqual(sorted[2].id, 5, 'p3 waitingSince 3000 tie-break id lebih kecil');
  assert.strictEqual(sorted[3].id, 8, 'p4 waitingSince 3000 tie-break id');
});

it('Q-3: pickNextFourPlayersForMatch mengelompokkan >= 4 putri dan menghindari 3 putra + 1 putri bila ada alternatif', () => {
  // Skenario A: Ada 4 putri dan 2 putra
  const femaleQ = [
    { id: 1, name: 'Putra 1', gender: 'L', role: 'Pemula', jumlah_main: 0 },
    { id: 2, name: 'Putri 1', gender: 'P', role: 'Pemula', jumlah_main: 0 },
    { id: 3, name: 'Putri 2', gender: 'P', role: 'Pemula', jumlah_main: 0 },
    { id: 4, name: 'Putri 3', gender: 'P', role: 'Pemula', jumlah_main: 0 },
    { id: 5, name: 'Putri 4', gender: 'P', role: 'Pemula', jumlah_main: 0 },
    { id: 6, name: 'Putra 2', gender: 'L', role: 'Pemula', jumlah_main: 0 }
  ];
  const fourFemale = pickNextFourPlayersForMatch(femaleQ, [], {}, femaleQ);
  assert.strictEqual(fourFemale.every(p => p.gender === 'P'), true, 'bila >= 4 putri menunggu, buat match khusus putri');

  // Skenario B: 4 teratas adalah 3 putra + 1 putri, tapi ada putra alternatif di posisi 5
  const mixedQ = [
    { id: 1, name: 'Putra 1', gender: 'L', role: 'Pemula', jumlah_main: 0 },
    { id: 2, name: 'Putra 2', gender: 'L', role: 'Pemula', jumlah_main: 0 },
    { id: 3, name: 'Putri 1', gender: 'P', role: 'Pemula', jumlah_main: 0 },
    { id: 4, name: 'Putra 3', gender: 'L', role: 'Pemula', jumlah_main: 0 },
    { id: 5, name: 'Putra 4', gender: 'L', role: 'Pemula', jumlah_main: 0 }
  ];
  const fourAvoidingOdd = pickNextFourPlayersForMatch(mixedQ, [], {}, mixedQ);
  assert.strictEqual(fourAvoidingOdd.every(p => p.gender === 'L'), true, 'hindari 3 putra + 1 putri bila ada putra alternatif');
});

// ── TEST 8: Rekan Tim Harus Berbeda-beda (Fitur 8) ──
console.log('\n--- 8. Rekan Tim Harus Berbeda-beda (Fitur 8) ---');

it('Memilih pasangan yang belum pernah bermain bersama sebelumnya', () => {
  const p = [
    { id: 1, name: 'A', role: 'Pemula' },
    { id: 2, name: 'B', role: 'Amatir' },
    { id: 3, name: 'C', role: 'Pemula' },
    { id: 4, name: 'D', role: 'Amatir' }
  ];

  // A dan B sudah pernah berpasangan
  const partnerHistory = {
    [getPairKey(1, 2)]: 1
  };

  const split = splitFourIntoTeamsSmart(p, partnerHistory, {}, []);

  // Pasangan A dan B tidak boleh terjadi karena masih ada kombinasi [A+C vs B+D] atau [A+D vs B+C]
  const teamAPairKey = getPairKey(split.teamA[0].id, split.teamA[1].id);
  const teamBPairKey = getPairKey(split.teamB[0].id, split.teamB[1].id);
  const abKey = getPairKey(1, 2);

  assert.notStrictEqual(teamAPairKey, abKey);
  assert.notStrictEqual(teamBPairKey, abKey);
  assert.strictEqual(split.isRepeatedPartner, false);
});

it('Jika semua kandidat sudah pernah berpasangan, fallback dengan penanda isRepeatedPartner', () => {
  const p = [
    { id: 1, name: 'A', role: 'Pemula' },
    { id: 2, name: 'B', role: 'Amatir' },
    { id: 3, name: 'C', role: 'Pemula' },
    { id: 4, name: 'D', role: 'Amatir' }
  ];

  // Semua pasangan sudah pernah sekali
  const partnerHistory = {
    [getPairKey(1, 2)]: 2,
    [getPairKey(3, 4)]: 2,
    [getPairKey(1, 3)]: 1,
    [getPairKey(2, 4)]: 1,
    [getPairKey(1, 4)]: 3,
    [getPairKey(2, 3)]: 3
  };

  const split = splitFourIntoTeamsSmart(p, partnerHistory, {}, []);

  // Harus memilih kombinasi dengan penalti terkecil yaitu 1+3 dan 2+4
  assert.strictEqual(split.isRepeatedPartner, true);
  const kA = getPairKey(split.teamA[0].id, split.teamA[1].id);
  assert.ok(kA === getPairKey(1, 3) || kA === getPairKey(2, 4));
});

it('Q-4: getPairKey menggunakan perbandingan string untuk id non-numerik (id a dan b)', () => {
  assert.strictEqual(getPairKey('a', 'b'), 'a-b');
  assert.strictEqual(getPairKey('b', 'a'), 'a-b');
  assert.strictEqual(getPairKey(10, 2), '2-10');
  assert.strictEqual(getPairKey('2', '10'), '2-10');
  assert.strictEqual(getPairKey('user_alpha', 'user_beta'), 'user_alpha-user_beta');
  assert.strictEqual(getPairKey('user_beta', 'user_alpha'), 'user_alpha-user_beta');
});

// ── TEST: BUG-4 Reset Sesi Mabar Baru ──
console.log('\n--- BUG-4. Reset Sesi Mabar Baru (resetBadmintonSession) ---');
it('BUG-4: Reset menyeluruh statistik, antrian, riwayat, dan kok namun mempertahankan pemain dan gelar juara', () => {
  const players = [
    { id: 1, name: 'Andi', status: PLAYER_STATUS.DI_LAPANGAN, jumlah_main: 3, cooldown_remaining: 1, request_used: true, leave_after_match: true, titles: 2 },
    { id: 2, name: 'Budi', status: PLAYER_STATUS.ISTIRAHAT, jumlah_main: 2, cooldown_remaining: 2, request_used: true, titles: 1 },
    { id: 3, name: 'Caca', status: PLAYER_STATUS.TIDAK_AKTIF, is_deleted: true, jumlah_main: 1, titles: 0 }
  ];
  const inventory = {
    stokAwalBaru: 24,
    stokAwalBekas: 12,
    terpakaiBaru: 6,
    terpakaiBekas: 4,
    bekasLayakDidapat: 3
  };

  // Test 1: Pertahankan pemain non-aktif (clearInactive: false)
  const res1 = resetBadmintonSession({ players, inventory, clearInactive: false });
  assert.strictEqual(res1.players.length, 3);
  assert.strictEqual(res1.players[0].status, PLAYER_STATUS.MENUNGGU);
  assert.strictEqual(res1.players[0].jumlah_main, 0);
  assert.strictEqual(res1.players[0].cooldown_remaining, 0);
  assert.strictEqual(res1.players[0].request_used, false);
  assert.strictEqual(res1.players[0].leave_after_match, false);
  assert.strictEqual(res1.players[0].titles, 2, 'Titles pemain harus tetap dipertahankan');

  // Pemain tidak aktif tetap berstatus tidak aktif jika clearInactive false
  assert.strictEqual(res1.players[2].status, PLAYER_STATUS.TIDAK_AKTIF);
  assert.strictEqual(res1.players[2].is_deleted, true);

  // Riwayat dan schedule ter-reset kosong
  assert.deepStrictEqual(res1.partnerHistory, {});
  assert.deepStrictEqual(res1.opponentHistory, {});
  assert.deepStrictEqual(res1.partnerRequests, []);
  assert.deepStrictEqual(res1.auditLog, []);
  assert.deepStrictEqual(res1.schedule, []);
  assert.strictEqual(res1.currentRoundIndex, 0);

  // Stok terpakai kok direset, stok awal dipertahankan
  assert.strictEqual(res1.inventory.stokAwalBaru, 24);
  assert.strictEqual(res1.inventory.stokAwalBekas, 12);
  assert.strictEqual(res1.inventory.terpakaiBaru, 0);
  assert.strictEqual(res1.inventory.terpakaiBekas, 0);

  // Test 2: Hapus permanen pemain non-aktif (clearInactive: true)
  const res2 = resetBadmintonSession({ players, inventory, clearInactive: true });
  assert.strictEqual(res2.players.length, 2);
  assert.strictEqual(res2.players.some(p => p.id === 3), false, 'Pemain tidak aktif harus terhapus permanen');
});

// ── TEST: BUG-7 Perangkat Terhubung ──
console.log('\n--- BUG-7. Hitungan Perangkat Terhubung (calculateActivePeers) ---');
it('BUG-7: calculateActivePeers menghitung peer aktif berdasarkan heartbeat dan membuang peer kadaluarsa', () => {
  const now = 100000;
  const heartbeats = new Map();
  heartbeats.set('peer-1', now - 10000); // 10s lalu (aktif)
  heartbeats.set('peer-2', now - 35000); // 35s lalu (aktif)
  heartbeats.set('peer-3', now - 45000); // 45s lalu (>40s, stale)

  // 2 aktif + 1 diri sendiri = 3
  const count = calculateActivePeers(heartbeats, 40000, now);
  assert.strictEqual(count, 3);

  // Jika heartbeats kosong, tetap ada 1 (perangkat sendiri)
  assert.strictEqual(calculateActivePeers(new Map(), 40000, now), 1);
});

// ── TEST: SEC-1 Sanitasi HTML escapeHtml ──
console.log('\n--- SEC-1. Sanitasi HTML (escapeHtml) ---');
it('escapeHtml menangani karakter khusus < > & " \' ` dan tipe falsy', () => {
  assert.strictEqual(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.strictEqual(escapeHtml("Tom & 'Jerry' `code`"), 'Tom &amp; &#39;Jerry&#39; &#96;code&#96;');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(123), '123');
});

console.log('--- SEC-1 / Q-6. Validasi State (validateAndNormalizeState) ---');
it('validateAndNormalizeState memvalidasi tipe, membatasi panjang nama, membuang field asing, dan menolak data rusak', () => {
  // Data valid
  const valid = {
    version: 3,
    sessionTitle: 'Mabar Sehat Ceria',
    bPlayers: [
      { id: 1, name: 'Pemain Satu Yang Sangat Panjang Sekali Namanya Melebihi Empat Puluh Karakter', role: 'Pemula' },
      { id: 2, name: 'Pemain Dua', role: 'Amatir' }
    ],
    unknownField: 'malicious payload'
  };
  const normalized = validateAndNormalizeState(valid);
  assert.ok(normalized);
  assert.strictEqual(normalized.sessionTitle, 'Mabar Sehat Ceria');
  assert.strictEqual(normalized.bPlayers.length, 2);
  assert.strictEqual(normalized.bPlayers[0].name.length, 40);
  assert.strictEqual(normalized.unknownField, undefined);

  // BUG-6: Memvalidasi dan mempertahankan nomor revisi state (rev)
  assert.strictEqual(validateAndNormalizeState({ ...valid, rev: 42 }).rev, 42);
  assert.strictEqual(validateAndNormalizeState({ ...valid, rev: -5 }).rev, 0);
  assert.strictEqual(validateAndNormalizeState({ ...valid, rev: 'invalid' }).rev, 0);
  assert.strictEqual(validateAndNormalizeState(valid).rev, 0);

  // Menolak duplikat ID pemain
  assert.strictEqual(validateAndNormalizeState({
    bPlayers: [{ id: 1, name: 'A' }, { id: 1, name: 'B' }]
  }), null);

  // Menolak jumlah pemain > 200
  const manyPlayers = Array.from({ length: 201 }, (_, i) => ({ id: i, name: `P${i}` }));
  assert.strictEqual(validateAndNormalizeState({ bPlayers: manyPlayers }), null);

  // Q-6: Menolak jika total match > 2000
  const hugeSchedule = Array.from({ length: 21 }, () => ({
    courts: Array.from({ length: 100 }, (_, i) => ({ courtNumber: i }))
  })); // 2100 matches
  assert.strictEqual(validateAndNormalizeState({ bSchedule: hugeSchedule }), null);

  // Q-6: Menolak pemain tanpa id atau id null
  assert.strictEqual(validateAndNormalizeState({ bPlayers: [{ name: 'Tanpa ID' }] }), null);
  assert.strictEqual(validateAndNormalizeState({ bPlayers: [{ id: null, name: 'ID Null' }] }), null);

  // Q-6: Menolak pemain yang bukan objek
  assert.strictEqual(validateAndNormalizeState({ bPlayers: ['stringBukanObjek'] }), null);

  // Q-6: Prototype pollution / injection diabaikan
  const malicious = {
    __proto__: { isAdmin: true },
    constructor: { prototype: { poll: true } },
    bPlayers: [{ id: 'player_alpha', name: 'Valid Alpha', role: 'Pemula' }]
  };
  const safeNormalized = validateAndNormalizeState(malicious);
  assert.ok(safeNormalized);
  assert.strictEqual(safeNormalized.isAdmin, undefined);
  assert.strictEqual(safeNormalized.bPlayers[0].id, 'player_alpha');

  // Menolak non-objek atau array di root
  assert.strictEqual(validateAndNormalizeState(null), null);
  assert.strictEqual(validateAndNormalizeState('invalid'), null);
  assert.strictEqual(validateAndNormalizeState([1, 2, 3]), null);
});

(async () => {
  console.log('\n--- SEC-2. Autentikasi Pesan MQTT & TOFU (MqttAuth) ---');
  await itAsync('Host menandatangani pesan dengan HMAC dan penerima menolak signature palsu/replay', async () => {
    const { deriveHmacKey, signMessage, verifyMessage } = BadmintonService.MqttAuth;
    const key = await deriveHmacKey('1234', 'ROOM-1');
    const msg = await signMessage({ type: 'STATE_UPDATE', roomId: 'ROOM-1', payload: { ok: true } }, { hmacKey: key, seq: 1 });
    
    // Valid
    const resOk = await verifyMessage(msg, { hmacKey: key, lastSeenSeq: 0 });
    assert.strictEqual(resOk.valid, true);

    // Replay
    const resReplay = await verifyMessage(msg, { hmacKey: key, lastSeenSeq: 1 });
    assert.strictEqual(resReplay.valid, false);

    // Tampered payload
    const tampered = { ...msg, payload: { ok: false } };
    const resTampered = await verifyMessage(tampered, { hmacKey: key, lastSeenSeq: 0 });
    assert.strictEqual(resTampered.valid, false);
  });

  await itAsync('Penonton memverifikasi signature Host via TOFU ECDSA', async () => {
    const { deriveHmacKey, generateEcdsaKeyPair, exportEcdsaPublicKey, signMessage, verifyMessage } = BadmintonService.MqttAuth;
    const kp = await generateEcdsaKeyPair();
    const pubHex = await exportEcdsaPublicKey(kp.publicKey);
    const key = await deriveHmacKey('1234', 'ROOM-1');

    const msg = await signMessage({ type: 'STATE_UPDATE', roomId: 'ROOM-1', payload: {} }, {
      hmacKey: key,
      ecdsaPrivateKey: kp.privateKey,
      hostPubHex: pubHex,
      seq: 2
    });

    const resTofu = await verifyMessage(msg, { isSpectator: true, trustedHostPub: null, lastSeenSeq: 0 });
    assert.strictEqual(resTofu.valid, true);
    assert.strictEqual(resTofu.newHostPub, pubHex);
  });

  console.log('\n--- SEC-3. Challenge-Response PIN (Tanpa Kebocoran Hash / PIN) ---');
  await itAsync('Challenge-response PIN memverifikasi kecocokan tanpa mempublikasikan PIN mentah atau pinHash', async () => {
    const { createPinChallenge, solvePinChallenge, verifyPinResponse } = BadmintonService.MqttAuth;
    const challenge = createPinChallenge('candidate-1', 'nonce-123');
    const solution = await solvePinChallenge(challenge.challengeNonce, '4321');
    const wrongSolution = await solvePinChallenge(challenge.challengeNonce, '9999');

    assert.strictEqual(await verifyPinResponse(challenge.challengeNonce, '4321', solution), true);
    assert.strictEqual(await verifyPinResponse(challenge.challengeNonce, '4321', wrongSolution), false);
  });

  console.log(`\n======================================================`);
  console.log(`TEST RESULTS: ${passCount} / ${testCount} Passed (${Math.round((passCount/testCount)*100)}%)`);
  console.log(`======================================================\n`);
})();
