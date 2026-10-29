/**
 * Unit Test Suite for ONESPORT Mini Soccer Team Management & Scoring Engine
 * Run with: node test-minisoccer.js
 */
const assert = require('assert');
const fs = require('fs');
const BadmintonService = require('./badminton-service.js');

// Global mock environment for Node
global.confirm = () => true;
global.prompt = (msg, def) => def;
global.window = { BadmintonService };

const htmlContent = fs.readFileSync('index.html', 'utf8');

// Global mock state
let sPlayers = [];
let sTeamCount = 2;
let sTeams = [];
let sMatches = [];
let sCurrentMatchIndex = 0;
let currentSport = 'minisoccer';

function checkEditPermission() { return true; }
function showToast() {}
function updateSessionLabels() {}
function renderPlayersList() {}
function renderCourtsView() {}
function renderLeaderboard() {}
function renderHistory() {}
function renderFinalPodium() {}
function persistAndBroadcast() {}
function updateSoccerTeamSelectOptions() {}
function escapeHtml(str) { return str || ''; }

const SOCCER_DEFAULT_TEAMS = [
  { name: 'Tim Garuda (A)', key: 'team-a' },
  { name: 'Tim Rajawali (B)', key: 'team-b' },
  { name: 'Tim Harimau (C)', key: 'team-c' },
  { name: 'Tim Singa (D)', key: 'team-d' }
];

eval(`
${htmlContent.substring(htmlContent.indexOf('function ensureSoccerTeamsInitialized('), htmlContent.indexOf('function updateSoccerTeamSelectOptions()'))}
${htmlContent.substring(htmlContent.indexOf('function startSoccerMatch('), htmlContent.indexOf('function stepFinishScore('))}
${htmlContent.substring(htmlContent.indexOf('function getSoccerStatsAndRankings('), htmlContent.indexOf('function renderLeaderboard()'))}
${htmlContent.substring(htmlContent.indexOf('function resolveStandingsByRules('), htmlContent.indexOf('function getBadmintonStatsAndRankings('))}
${htmlContent.substring(htmlContent.indexOf('function parseSemVer('), htmlContent.indexOf('async function checkAppUpdates('))}
${htmlContent.substring(htmlContent.indexOf('function deleteSoccerMatch('), htmlContent.indexOf('// ── MODAL INPUT SKOR PER MATCH MINI SOCCER ──'))}
`);

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

console.log('\n=== RUNNING ONESPORT MINI SOCCER TEAM MANAGEMENT TESTS ===\n');

console.log('--- 1. Inisialisasi State Mini Soccer Kosong & Tanpa Dummy Data ---');
it('Mini soccer bersih dan kosong saat inisialisasi awal tanpa data dummy', () => {
  sTeams = [];
  sPlayers = [];
  sMatches = [];
  sTeamCount = 0;
  ensureSoccerTeamsInitialized();

  assert.strictEqual(sTeams.length, 0, 'sTeams harus tetap kosong saat inisialisasi tanpa data dummy');
  assert.strictEqual(sPlayers.length, 0, 'sPlayers harus tetap kosong');
  assert.strictEqual(sMatches.length, 0, 'sMatches harus tetap kosong tanpa tim');
});

console.log('\n--- 2. Tambah Tim Bebas (Lebih dari 4 Tim) ---');
it('addNewSoccerTeam menambah tim baru dan memperbarui jumlah tim', () => {
  addNewSoccerTeam('Tim Garuda (A)');
  assert.strictEqual(sTeams.length, 1);
  assert.strictEqual(sMatches.length, 0, '1 tim belum cukup untuk jadwal pertandingan');

  addNewSoccerTeam('Tim Rajawali (B)');
  assert.strictEqual(sTeams.length, 2);
  assert.strictEqual(sMatches.length, 3, 'Untuk 2 tim, default terjadwal 3 ronde match');

  addNewSoccerTeam('Tim Elang (C)');
  assert.strictEqual(sTeams.length, 3);
  assert.strictEqual(sTeams[2].name, 'Tim Elang (C)');
  assert.strictEqual(sPlayers.length, 0);

  // Jadwal round-robin untuk 3 tim: 3 match
  assert.strictEqual(sMatches.length, 3);
});

it('Bisa menambah hingga 5 dan 6 tim secara dinamis tanpa batasan 4 tim', () => {
  addNewSoccerTeam('Tim Singa (D)');
  assert.strictEqual(sTeams.length, 4);

  addNewSoccerTeam('Tim Macan (E)');
  assert.strictEqual(sTeams.length, 5);

  addNewSoccerTeam('Tim Serigala (F)');
  assert.strictEqual(sTeams.length, 6);

  // Untuk 6 tim, total match round-robin adalah 6 * 5 / 2 = 15 match
  generateSoccerMatchSchedule();
  assert.strictEqual(sMatches.length, 15);
  assert.strictEqual(sPlayers.length, 0);
});

console.log('\n--- 3. Hapus Tim & Batasan Minimal 2 Tim ---');
it('removeSoccerTeam menghapus tim dan membersihkan match terkait', () => {
  const initialTeams = sTeams.length; // 6
  removeSoccerTeam(5); // Hapus Tim Serigala (F)
  assert.strictEqual(sTeams.length, initialTeams - 1); // 5 tim

  // Match yang tersisa adalah 5 * 4 / 2 = 10 match
  assert.strictEqual(sMatches.length, 10);
});

it('removeSoccerTeam menolak menghapus jika tim tinggal 2', () => {
  sTeams = [
    { name: 'Tim A', key: 'team-a', players: [] },
    { name: 'Tim B', key: 'team-b', players: [] }
  ];
  sMatches = [];
  generateSoccerMatchSchedule();

  removeSoccerTeam(1);
  assert.strictEqual(sTeams.length, 2, 'Tim tidak boleh berkurang di bawah 2');
});

console.log('\n--- 4. Penyesuaian Skor Pertandingan & Klasemen Poin ---');
it('changeSoccerMatchScore menambah/mengurang skor gol dan menentukan pemenang', () => {
  sTeams = [
    { name: 'Tim Garuda', key: 'team-a', players: [] },
    { name: 'Tim Rajawali', key: 'team-b', players: [] }
  ];
  generateSoccerMatchSchedule();

  // Match 0: Garuda vs Rajawali
  changeSoccerMatchScore(0, 'A', 2); // 2-0
  assert.strictEqual(sMatches[0].scoreA, 2);
  assert.strictEqual(sMatches[0].scoreB, 0);
  assert.strictEqual(sMatches[0].winner, 'A');
  assert.strictEqual(sMatches[0].status, 'finished');

  changeSoccerMatchScore(0, 'B', 2); // 2-2 Seri
  assert.strictEqual(sMatches[0].scoreA, 2);
  assert.strictEqual(sMatches[0].scoreB, 2);
  assert.strictEqual(sMatches[0].winner, 'D');

  changeSoccerMatchScore(0, 'B', 1); // 2-3 Rajawali menang
  assert.strictEqual(sMatches[0].scoreB, 3);
  assert.strictEqual(sMatches[0].winner, 'B');
});

it('getSoccerStatsAndRankings menghitung klasemen murni berbasis tim tanpa pemain', () => {
  // Rajawali menang 3-2 atas Garuda di match 0
  const standings = getSoccerStatsAndRankings('wins');
  assert.strictEqual(standings.length, 2);

  // Juara 1: Rajawali (3 PTS, 1 W, GD +1)
  assert.strictEqual(standings[0].name, 'Tim Rajawali');
  assert.strictEqual(standings[0].pts, 3);
  assert.strictEqual(standings[0].w, 1);
  assert.strictEqual(standings[0].gf, 3);
  assert.strictEqual(standings[0].ga, 2);
  assert.strictEqual(standings[0].gd, 1);

  // Posisi 2: Garuda (0 PTS, 1 L, GD -1)
  assert.strictEqual(standings[1].name, 'Tim Garuda');
  assert.strictEqual(standings[1].pts, 0);
  assert.strictEqual(standings[1].l, 1);
  assert.strictEqual(standings[1].gd, -1);
});

console.log('\n--- 5. Kosongkan Tim Mini Soccer ---');
it('clearAllSoccerTeams mengosongkan seluruh tim, skor, dan jadwal Mini Soccer', () => {
  clearAllSoccerTeams();
  assert.strictEqual(sTeams.length, 0);
  assert.strictEqual(sMatches.length, 0);
  assert.strictEqual(sPlayers.length, 0);
  assert.strictEqual(sTeamCount, 0);
});

// Global mock DOM elements
const mockElements = {};
global.document = {
  getElementById: (id) => {
    if (!mockElements[id]) {
      mockElements[id] = {
        value: '',
        textContent: '',
        innerHTML: '',
        checked: false,
        disabled: false,
        style: {},
        classList: {
          _classes: new Set(),
          add: function(c) { this._classes.add(c); },
          remove: function(c) { this._classes.delete(c); },
          contains: function(c) { return this._classes.has(c); }
        }
      };
    }
    return mockElements[id];
  },
  querySelector: (sel) => {
    if (sel.includes('soccer_modal_winner_radio')) {
      if (mockElements['soccerWinRadioA']?.checked) return { value: 'A' };
      if (mockElements['soccerWinRadioB']?.checked) return { value: 'B' };
      if (mockElements['soccerWinRadioD']?.checked) return { value: 'D' };
    }
    return null;
  }
};

console.log('\n--- 6. Modal Input Skor & Pemenang Pertandingan ---');
it('openSoccerScoreModal dan submitSoccerModalScore mengupdate skor dan status match', () => {
  sTeams = [
    { name: 'Garuda FC', key: 'team-a', players: [] },
    { name: 'Rajawali FC', key: 'team-b', players: [] },
    { name: 'Harimau FC', key: 'team-c', players: [] }
  ];
  generateSoccerMatchSchedule();

  // Reset modal elements
  openSoccerScoreModal(0);
  assert.strictEqual(document.getElementById('soccerScoreTargetMatchIdx').value, 0);
  assert.strictEqual(document.getElementById('soccerScoreModalTitle').textContent, 'Input Skor: Match 1 • Garuda FC vs Rajawali FC');

  // Set skor via step
  stepSoccerModalScore('A', 3); // A = 3
  stepSoccerModalScore('B', 1); // B = 1
  assert.strictEqual(document.getElementById('inputSoccerModalScoreA').value, 3);
  assert.strictEqual(document.getElementById('inputSoccerModalScoreB').value, 1);
  assert.strictEqual(document.getElementById('soccerWinRadioA').checked, true);

  // Submit skor
  submitSoccerModalScore();
  assert.strictEqual(sMatches[0].scoreA, 3);
  assert.strictEqual(sMatches[0].scoreB, 1);
  assert.strictEqual(sMatches[0].winner, 'A');
  assert.strictEqual(sMatches[0].status, 'finished');
});

console.log('\n--- 7. Deteksi Tim Siap-Siap Masuk Lapangan (On-Deck) ---');
it('Mengidentifikasi pertandingan berikutnya dan tim yang siap masuk lapangan', () => {
  // sMatches[0] sudah finished (Garuda vs Rajawali)
  // sMatches[1] adalah Rajawali vs Harimau (pending)
  // sMatches[2] adalah Garuda vs Harimau (pending)

  const ongoingMatch = sMatches.find(m => m.status === 'ongoing');
  const nextPendingMatch = sMatches.find(m => m.status === 'pending');

  assert.strictEqual(ongoingMatch, undefined, 'Belum ada match ongoing karena match 0 baru beres');
  assert.ok(nextPendingMatch, 'Ada match pending berikutnya');
  assert.strictEqual(nextPendingMatch.title, 'Match 2 • Rajawali FC vs Harimau FC');

  // Evaluasi status masing-masing tim untuk banner dan chip antrian
  function getTeamPitchStatus(teamName) {
    const isPlaying = ongoingMatch && (ongoingMatch.teamA.name === teamName || ongoingMatch.teamB.name === teamName);
    const isNext = !isPlaying && nextPendingMatch && (nextPendingMatch.teamA.name === teamName || nextPendingMatch.teamB.name === teamName);
    if (isPlaying) return 'Sedang Main';
    if (isNext) return 'Siap Masuk';
    return 'Istirahat';
  }

  assert.strictEqual(getTeamPitchStatus('Rajawali FC'), 'Siap Masuk');
  assert.strictEqual(getTeamPitchStatus('Harimau FC'), 'Siap Masuk');
  assert.strictEqual(getTeamPitchStatus('Garuda FC'), 'Istirahat');

  // Jika match 1 dimulai (kickoff)
  nextPendingMatch.status = 'ongoing';
  const newOngoing = sMatches.find(m => m.status === 'ongoing');
  const newNext = sMatches.find(m => m.status === 'pending');

  assert.strictEqual(newOngoing.title, 'Match 2 • Rajawali FC vs Harimau FC');
  assert.strictEqual(newNext.title, 'Match 3 • Garuda FC vs Harimau FC');

  // Sekarang Rajawali & Harimau sedang main, Garuda siap-siap masuk
  function getUpdatedTeamPitchStatus(teamName) {
    const isPlaying = newOngoing && (newOngoing.teamA.name === teamName || newOngoing.teamB.name === teamName);
    const isNext = !isPlaying && newNext && (newNext.teamA.name === teamName || newNext.teamB.name === teamName);
    if (isPlaying) return 'Sedang Main';
    if (isNext) return 'Siap Masuk';
    return 'Istirahat';
  }

  assert.strictEqual(getUpdatedTeamPitchStatus('Rajawali FC'), 'Sedang Main');
  assert.strictEqual(getUpdatedTeamPitchStatus('Harimau FC'), 'Sedang Main');
  assert.strictEqual(getUpdatedTeamPitchStatus('Garuda FC'), 'Siap Masuk');
});

console.log('\n--- 8. Atur Bagan Manual & Tukar Posisi Tim (Fitur Bagan Pilihan) ---');
it('swapSoccerMatchTeams menukar Tim A ↔ Tim B, skor, dan memperbarui judul match', () => {
  sTeams = [
    { name: 'Persib (A)', key: 'team-a', players: [] },
    { name: 'Persija (B)', key: 'team-b', players: [] }
  ];
  sMatches = [
    { roundNumber: 1, title: 'Match 1 • Persib (A) vs Persija (B)', teamA: sTeams[0], teamB: sTeams[1], scoreA: 2, scoreB: 1, winner: 'A', status: 'finished' }
  ];

  swapSoccerMatchTeams(0);
  assert.strictEqual(sMatches[0].teamA.name, 'Persija (B)');
  assert.strictEqual(sMatches[0].teamB.name, 'Persib (A)');
  assert.strictEqual(sMatches[0].scoreA, 1);
  assert.strictEqual(sMatches[0].scoreB, 2);
  assert.strictEqual(sMatches[0].winner, 'B');
  assert.strictEqual(sMatches[0].title, 'Match 1 • Persija (B) vs Persib (A)');
});

it('openSoccerMatchModal dan saveSoccerMatchModal mengubah lawan pada bagan yang sudah ada', () => {
  sTeams = [
    { name: 'Tim Merah', key: 'team-1', players: [] },
    { name: 'Tim Biru', key: 'team-2', players: [] },
    { name: 'Tim Hijau', key: 'team-3', players: [] }
  ];
  sMatches = [
    { roundNumber: 1, title: 'Match 1 • Tim Merah vs Tim Biru', teamA: sTeams[0], teamB: sTeams[1], scoreA: null, scoreB: null, winner: null, status: 'pending' }
  ];

  openSoccerMatchModal(0);
  assert.strictEqual(document.getElementById('soccerMatchModalTargetIdx').value, 0);
  assert.strictEqual(document.getElementById('soccerMatchSelectTeamA').value, 0);
  assert.strictEqual(document.getElementById('soccerMatchSelectTeamB').value, 1);

  // Ubah lawan Tim Merah dari Tim Biru menjadi Tim Hijau (index 2)
  document.getElementById('soccerMatchSelectTeamB').value = 2;
  saveSoccerMatchModal();

  assert.strictEqual(sMatches[0].teamA.name, 'Tim Merah');
  assert.strictEqual(sMatches[0].teamB.name, 'Tim Hijau');
  assert.strictEqual(sMatches[0].title, 'Match 1 • Tim Merah vs Tim Hijau');
});

it('saveSoccerMatchModal menolak jika Tim A dan Tim B adalah tim yang sama (validasi bagan)', () => {
  sTeams = [
    { name: 'Tim Alpha', key: 'team-a', players: [] },
    { name: 'Tim Beta', key: 'team-b', players: [] }
  ];
  sMatches = [
    { roundNumber: 1, title: 'Match 1 • Tim Alpha vs Tim Beta', teamA: sTeams[0], teamB: sTeams[1], scoreA: null, scoreB: null, winner: null, status: 'pending' }
  ];

  openSoccerMatchModal(0);
  // Pilih Tim Alpha untuk keduanya
  document.getElementById('soccerMatchSelectTeamA').value = 0;
  document.getElementById('soccerMatchSelectTeamB').value = 0;
  updateSoccerMatchModalPreview();

  assert.strictEqual(document.getElementById('soccerMatchModalError').style.display, 'block');
  assert.strictEqual(document.getElementById('btnSoccerMatchModalSave').disabled, true);

  // Coba paksa save
  saveSoccerMatchModal();
  // Bagan match 0 tidak boleh berubah menjadi Tim Alpha vs Tim Alpha
  assert.notStrictEqual(sMatches[0].teamA.name, sMatches[0].teamB.name);
  assert.strictEqual(sMatches[0].teamB.name, 'Tim Beta');
});

it('saveSoccerMatchModal menambah match baru saat targetIdx kosong', () => {
  sTeams = [
    { name: 'Tim X', key: 'team-x', players: [] },
    { name: 'Tim Y', key: 'team-y', players: [] }
  ];
  sMatches = [];

  openSoccerMatchModal(null); // Mode buat baru, ensureSoccerTeamsInitialized membuat 3 ronde default
  const prevLen = sMatches.length; // 3
  assert.strictEqual(document.getElementById('soccerMatchModalTargetIdx').value, '');
  document.getElementById('soccerMatchSelectTeamA').value = 0;
  document.getElementById('soccerMatchSelectTeamB').value = 1;

  saveSoccerMatchModal();
  assert.strictEqual(sMatches.length, prevLen + 1);
  const newMatch = sMatches[sMatches.length - 1];
  assert.strictEqual(newMatch.roundNumber, prevLen + 1);
  assert.strictEqual(newMatch.teamA.name, 'Tim X');
  assert.strictEqual(newMatch.teamB.name, 'Tim Y');
  assert.strictEqual(newMatch.title, `Match ${prevLen + 1} • Tim X vs Tim Y`);
});

it('swapSoccerMatchModalTeams menukar pilihan dropdown tim di dalam modal', () => {
  document.getElementById('soccerMatchSelectTeamA').value = 0;
  document.getElementById('soccerMatchSelectTeamB').value = 1;
  swapSoccerMatchModalTeams();
  assert.strictEqual(document.getElementById('soccerMatchSelectTeamA').value, 1);
  assert.strictEqual(document.getElementById('soccerMatchSelectTeamB').value, 0);
});

it('handleCustomMatchOrCourtAction membuka modal match mini soccer saat currentSport === minisoccer', () => {
  currentSport = 'minisoccer';
  let modalOpened = false;
  const originalOpen = openSoccerMatchModal;
  openSoccerMatchModal = () => { modalOpened = true; };
  handleCustomMatchOrCourtAction();
  assert.strictEqual(modalOpened, true);
  openSoccerMatchModal = originalOpen;
});

console.log(`\n--- 9. Fixes & Robustness (Bug Analysis Verification) ---`);

it('setSoccerWinner mempertahankan skor kustom pengguna yang konsisten dengan pemenang', () => {
  sMatches = [{
    roundNumber: 1,
    title: 'Match 1 • Tim Alpha vs Tim Beta',
    teamA: { name: 'Tim Alpha', key: 'team-a' },
    teamB: { name: 'Tim Beta', key: 'team-b' },
    scoreA: 4,
    scoreB: 1,
    winner: null,
    status: 'ongoing'
  }];

  setSoccerWinner(0, 'A');
  // Skor kustom 4-1 harus dipertahankan, BUKAN di-overwrite menjadi 2-1
  assert.strictEqual(sMatches[0].scoreA, 4);
  assert.strictEqual(sMatches[0].scoreB, 1);
  assert.strictEqual(sMatches[0].winner, 'A');
  assert.strictEqual(sMatches[0].status, 'finished');
});

it('startSoccerMatch menegakkan hanya 1 match yang ongoing secara bersamaan', () => {
  sMatches = [
    {
      roundNumber: 1,
      title: 'Match 1 • Tim A vs Tim B',
      teamA: { name: 'Tim A', key: 'team-a' },
      teamB: { name: 'Tim B', key: 'team-b' },
      scoreA: null,
      scoreB: null,
      winner: null,
      status: 'ongoing'
    },
    {
      roundNumber: 2,
      title: 'Match 2 • Tim C vs Tim D',
      teamA: { name: 'Tim C', key: 'team-c' },
      teamB: { name: 'Tim D', key: 'team-d' },
      scoreA: null,
      scoreB: null,
      winner: null,
      status: 'pending'
    }
  ];

  startSoccerMatch(1);
  // Match 2 menjadi ongoing, match 1 yang belum berskor kembali ke pending
  assert.strictEqual(sMatches[1].status, 'ongoing');
  assert.strictEqual(sMatches[0].status, 'pending');
});

it('deleteSoccerMatch meregenerasi judul match secara bersih tanpa duplikasi separator', () => {
  sMatches = [
    {
      roundNumber: 1,
      title: 'Match 1 • Tim A vs Tim B',
      teamA: { name: 'Tim A', key: 'team-a' },
      teamB: { name: 'Tim B', key: 'team-b' },
      status: 'finished'
    },
    {
      roundNumber: 2,
      title: 'Match 2 • Tim B vs Tim C',
      teamA: { name: 'Tim B', key: 'team-b' },
      teamB: { name: 'Tim C', key: 'team-c' },
      status: 'pending'
    }
  ];

  deleteSoccerMatch(0);
  assert.strictEqual(sMatches.length, 1);
  assert.strictEqual(sMatches[0].roundNumber, 1);
  assert.strictEqual(sMatches[0].title, 'Match 1 • Tim B vs Tim C');
});

it('getSoccerStatsAndRankings menangani data match null atau tanpa tim secara aman', () => {
  sTeams = [
    { name: 'Tim A', key: 'team-a', players: [] },
    { name: 'Tim B', key: 'team-b', players: [] }
  ];
  sMatches = [
    null,
    { status: 'finished', teamA: null, teamB: null },
    { status: 'finished', teamA: { name: 'Tim A' }, teamB: null },
    { status: 'finished', teamA: { name: 'Tim A' }, teamB: { name: 'Tim B' }, scoreA: 3, scoreB: 1, winner: 'A' }
  ];

  const rankings = getSoccerStatsAndRankings('wins');
  assert.strictEqual(rankings.length, 2);
  const teamAStats = rankings.find(t => t.name === 'Tim A');
  assert.strictEqual(teamAStats.p, 1);
  assert.strictEqual(teamAStats.wins, 1);
  assert.strictEqual(teamAStats.pts, 3);
});

it('isNewerVersion mengidentifikasi build v1.2.0-b44 secara akurat', () => {
  assert.strictEqual(isNewerVersion('v1.2.0-b44', 'v1.2.0-b44'), false);
  assert.strictEqual(isNewerVersion('v1.2.0-b45', 'v1.2.0-b44'), true);
  assert.strictEqual(isNewerVersion('v1.2.1', 'v1.2.0-b44'), true);
  assert.strictEqual(isNewerVersion('v1.2.0-b43', 'v1.2.0-b44'), false);
  assert.strictEqual(isNewerVersion('v1.1.9', 'v1.2.0-b44'), false);
});

// ----------------------------------------------------------------------------
// 10. Penyisihan Grup & Tahap Grup Opsional (Badminton & Mini Soccer)
// ----------------------------------------------------------------------------
console.log('\n--- 10. Penyisihan Grup & Tahap Grup Opsional ---');

it('createMiniSoccerLiga membagi tim ke Grup A & Grup B, membuat jadwal grup, dan menyusun babak gugur', () => {
  const teams = [
    { name: 'Garuda', key: 't1', group: 'A' },
    { name: 'Rajawali', key: 't2', group: 'A' },
    { name: 'Elang', key: 't3', group: 'B' },
    { name: 'Harimau', key: 't4', group: 'B' }
  ];
  const liga = BadmintonService.createMiniSoccerLiga({
    teams,
    matches: [],
    groupCount: 2,
    topAdvance: 2
  });
  assert.strictEqual(liga.groupLabels.length, 2);
  assert.strictEqual(liga.groupMatches.length, 2);
  assert.strictEqual(liga.groupMatches[0].group, 'A');
  assert.strictEqual(liga.groupMatches[1].group, 'B');
  assert.strictEqual(liga.qualifiers.length, 4);
  assert.strictEqual(liga.championshipMatches.length, 4); // SF1, SF2, THIRD, FINAL
});

it('generateSoccerMatchSchedule tetap mode reguler saat sGroupStage.enabled === false dan mode grup saat enabled === true', () => {
  sTeams = [
    { name: 'Tim 1', key: 't1', group: 'A', players: [] },
    { name: 'Tim 2', key: 't2', group: 'A', players: [] },
    { name: 'Tim 3', key: 't3', group: 'B', players: [] },
    { name: 'Tim 4', key: 't4', group: 'B', players: [] }
  ];
  global.sGroupStage = { enabled: false, groupCount: 2, topAdvance: 2 };
  generateSoccerMatchSchedule();
  assert.strictEqual(sMatches.length, 6, 'Mode reguler 4 tim menghasilkan 6 match round-robin');

  global.sGroupStage = { enabled: true, groupCount: 2, topAdvance: 2 };
  generateSoccerMatchSchedule();
  assert.strictEqual(sMatches.length, 2, 'Mode penyisihan 2 grup (masing-masing 2 tim) menghasilkan 2 match penyisihan grup');
  assert.strictEqual(sMatches[0].stage, 'GROUP');
  global.sGroupStage = { enabled: false, groupCount: 2, topAdvance: 2 };
});

it('createLeagueTournament menghitung klasemen per grup Badminton dan kelolosan babak gugur', () => {
  const players = [
    { id: 1, name: 'Andi', gender: 'L', role: 'Pemula', group: 'A' },
    { id: 2, name: 'Budi', gender: 'L', role: 'Pemula', group: 'A' },
    { id: 3, name: 'Cici', gender: 'P', role: 'Pemula', group: 'A' },
    { id: 4, name: 'Dedi', gender: 'L', role: 'Pemula', group: 'A' },
    { id: 5, name: 'Eka', gender: 'L', role: 'Pemula', group: 'B' },
    { id: 6, name: 'Fajar', gender: 'L', role: 'Pemula', group: 'B' },
    { id: 7, name: 'Gita', gender: 'P', role: 'Pemula', group: 'B' },
    { id: 8, name: 'Hadi', gender: 'L', role: 'Pemula', group: 'B' }
  ];
  const res = BadmintonService.createLeagueTournament({
    players,
    schedule: [],
    groupCount: 2,
    topAdvance: 2
  });
  assert.strictEqual(res.groupLabels.length, 2);
  assert.strictEqual(res.groups.A.length, 4);
  assert.strictEqual(res.groups.B.length, 4);
  assert.strictEqual(res.qualifiers.length, 4);
  assert.ok(res.championshipMatches.length >= 1);
});

console.log(`\n======================================================`);
console.log(`MINI SOCCER TEST RESULTS: ${passCount} / ${testCount} Passed (${Math.round((passCount/testCount)*100)}%)`);
console.log(`======================================================\n`);

if (passCount !== testCount) {
  process.exitCode = 1;
}
