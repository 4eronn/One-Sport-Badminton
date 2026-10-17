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
${htmlContent.substring(htmlContent.indexOf('function ensureSoccerTeamsInitialized()'), htmlContent.indexOf('function updateSoccerTeamSelectOptions()'))}
${htmlContent.substring(htmlContent.indexOf('function setSoccerWinner('), htmlContent.indexOf('function stepFinishScore('))}
${htmlContent.substring(htmlContent.indexOf('function getSoccerStatsAndRankings('), htmlContent.indexOf('function renderLeaderboard()'))}
${htmlContent.substring(htmlContent.indexOf('function resolveStandingsByRules('), htmlContent.indexOf('function getBadmintonStatsAndRankings('))}
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

console.log('--- 1. Inisialisasi Tim Default & Tanpa Pemain ---');
it('ensureSoccerTeamsInitialized membuat minimal 2 tim default saat kosong', () => {
  sTeams = [];
  sPlayers = [];
  sMatches = [];
  ensureSoccerTeamsInitialized();

  assert.strictEqual(sTeams.length, 2);
  assert.strictEqual(sTeams[0].name, 'Tim Garuda (A)');
  assert.strictEqual(sTeams[1].name, 'Tim Rajawali (B)');
  assert.strictEqual(sPlayers.length, 0, 'sPlayers harus tetap kosong tanpa input pemain');
  assert.strictEqual(sMatches.length, 3, 'Untuk 2 tim, default terjadwal 3 ronde match');
});

console.log('\n--- 2. Tambah Tim Bebas (Lebih dari 4 Tim) ---');
it('addNewSoccerTeam menambah tim baru dan memperbarui jumlah tim', () => {
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

console.log('\n--- 5. Reset Tim Mini Soccer ---');
it('clearAllSoccerTeams mereset tim ke 2 tim default dan membersihkan skor', () => {
  clearAllSoccerTeams();
  assert.strictEqual(sTeams.length, 2);
  assert.strictEqual(sTeams[0].name, 'Tim Garuda (A)');
  assert.strictEqual(sTeams[1].name, 'Tim Rajawali (B)');
  assert.strictEqual(sMatches.length, 3);
  assert.strictEqual(sMatches[0].scoreA, null);
  assert.strictEqual(sMatches[0].status, 'ongoing');
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

console.log(`\n======================================================`);
console.log(`MINI SOCCER TEST RESULTS: ${passCount} / ${testCount} Passed (${Math.round((passCount/testCount)*100)}%)`);
console.log(`======================================================\n`);

if (passCount !== testCount) {
  process.exitCode = 1;
}
