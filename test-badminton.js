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
    status: COURT_STATUS.SELESAI,
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

  // Menolak non-objek
  assert.strictEqual(validateAndNormalizeState(null), null);
  assert.strictEqual(validateAndNormalizeState('invalid'), null);
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
