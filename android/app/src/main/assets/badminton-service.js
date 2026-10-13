/**
 * ============================================================================
 * ONESPORT BADMINTON SERVICE & RULES ENGINE
 * Modul logika bisnis terpisah untuk antrian, pairing, rotasi, kuota main,
 * request rekan tim, host ACC, klasemen real-time, dan monitoring kok.
 * ============================================================================
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.BadmintonService = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── KONSTANTA STATUS ──
  const PLAYER_STATUS = {
    MENUNGGU: 'menunggu',
    DI_LAPANGAN: 'di_lapangan',
    ISTIRAHAT: 'istirahat',
    TIDAK_AKTIF: 'tidak_aktif'
  };

  const COURT_STATUS = {
    KOSONG: 'kosong',
    MENUNGGU_ACC: 'menunggu_acc',
    SEDANG_MAIN: 'sedang_main',
    FINISHED: 'finished'
  };

  const REQUEST_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed'
  };

  /**
   * Helper untuk membuat pair key konsisten: "idKecil-idBesar"
   */
  function getPairKey(id1, id2) {
    const a = Number(id1);
    const b = Number(id2);
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  // ── 1. PEMERIKSAAN ROLE / LEVEL ──
  function isIntermediateRole(player) {
    if (!player || !player.role) return false;
    const r = String(player.role).toLowerCase();
    return r.includes('inter');
  }

  function isAdvanceRole(player) {
    if (!player || !player.role) return false;
    const r = String(player.role).toLowerCase();
    return r.includes('adv');
  }

  function hasInterAndAdvanceTogether(team) {
    if (!Array.isArray(team)) return false;
    const valid = team.filter(Boolean);
    const hasInter = valid.some(isIntermediateRole);
    const hasAdv = valid.some(isAdvanceRole);
    return hasInter && hasAdv;
  }

  // ── 2. MIGRASI & BACKFILL DATA (BACKWARD COMPATIBILITY) ──
  /**
   * Backfill jumlah_main dan partner_history dari riwayat match yang sudah selesai.
   * Aman untuk data lama tanpa merusak atau mereset data berjalan.
   */
  function backfillPlayerStats(players = [], schedule = []) {
    const playCountMap = {};
    const partnerHistory = {};
    const opponentHistory = {};
    const finishedMatchList = [];

    // Inisialisasi play count
    players.forEach(p => {
      playCountMap[p.id] = 0;
    });

    // Iterasi semua ronde dan lapangan
    schedule.forEach(round => {
      if (!round) return;
      const allCourts = [...(round.courts || []), ...(round.finishedCourts || [])];
      allCourts.forEach(court => {
        if (!court || court.status !== 'finished') return;
        finishedMatchList.push(court);

        const teamA = (court.teamA || []).filter(Boolean);
        const teamB = (court.teamB || []).filter(Boolean);

        // Tambah jumlah main
        [...teamA, ...teamB].forEach(p => {
          if (p && p.id !== undefined) {
            playCountMap[p.id] = (playCountMap[p.id] || 0) + 1;
          }
        });

        // Partner history Team A
        if (teamA.length >= 2 && teamA[0] && teamA[1]) {
          const kA = getPairKey(teamA[0].id, teamA[1].id);
          partnerHistory[kA] = (partnerHistory[kA] || 0) + 1;
        }

        // Partner history Team B
        if (teamB.length >= 2 && teamB[0] && teamB[1]) {
          const kB = getPairKey(teamB[0].id, teamB[1].id);
          partnerHistory[kB] = (partnerHistory[kB] || 0) + 1;
        }

        // Opponent history antar lawan
        teamA.forEach(pA => {
          teamB.forEach(pB => {
            if (pA && pB) {
              const kOpp = getPairKey(pA.id, pB.id);
              opponentHistory[kOpp] = (opponentHistory[kOpp] || 0) + 1;
            }
          });
        });
      });
    });

    // Perbarui objek pemain tanpa merusak field yang sudah ada
    players.forEach(p => {
      if (typeof p.jumlah_main !== 'number') {
        p.jumlah_main = playCountMap[p.id] || 0;
      }
      if (!p.status) {
        p.status = PLAYER_STATUS.MENUNGGU;
      }
      if (typeof p.request_used !== 'boolean') {
        p.request_used = false;
      }
      if (typeof p.cooldown_remaining !== 'number') {
        p.cooldown_remaining = 0;
      }
      if (typeof p.leave_after_match !== 'boolean') {
        p.leave_after_match = false;
      }
      if (typeof p.is_deleted !== 'boolean') {
        p.is_deleted = false;
      }
    });

    return {
      playCountMap,
      partnerHistory,
      opponentHistory,
      finishedMatchesCount: finishedMatchList.length
    };
  }

  /**
   * Memastikan integritas status pemain saat aplikasi dimuat atau disinkronkan.
   */
  function syncActivePlayerStatuses(players = [], currentCourts = []) {
    const onCourtPlayerIds = new Set();
    const pendingAccPlayerIds = new Set();

    currentCourts.forEach(c => {
      if (!c) return;
      const courtPlayers = [...(c.teamA || []), ...(c.teamB || [])].filter(Boolean);
      if (c.status === 'sedang_main' || c.status === 'ongoing') {
        courtPlayers.forEach(p => onCourtPlayerIds.add(p.id));
      } else if (c.status === 'menunggu_acc') {
        // Sedang diajukan ke lapangan, belum ACC
        courtPlayers.forEach(p => pendingAccPlayerIds.add(p.id));
      }
    });

    players.forEach(p => {
      if (p.is_deleted || p.status === PLAYER_STATUS.TIDAK_AKTIF) {
        p.status = PLAYER_STATUS.TIDAK_AKTIF;
      } else if (onCourtPlayerIds.has(p.id)) {
        p.status = PLAYER_STATUS.DI_LAPANGAN;
      } else if (pendingAccPlayerIds.has(p.id)) {
        // Sedang diajukan ke lapangan, belum ACC
      } else if (p.cooldown_remaining > 0) {
        p.status = PLAYER_STATUS.ISTIRAHAT;
      } else {
        p.status = PLAYER_STATUS.MENUNGGU;
      }
    });

    return players;
  }

  // ── 3. FITUR 1 & 7: ANTRIAN, COOLDOWN, & PRIORITAS JUMLAH MAIN ──
  /**
   * Filter antrian: HANYA pemain berstatus 'menunggu' dan tidak sedang soft-deleted.
   * Pemain di_lapangan, istirahat, dan tidak_aktif DILARANG masuk antrian.
   */
  function getEligibleQueue(players = []) {
    return players.filter(p => {
      if (!p) return false;
      if (p.is_deleted) return false;
      return p.status === PLAYER_STATUS.MENUNGGU;
    });
  }

  /**
   * Pengurutan antrian berdasarkan prioritas:
   * 1. Pemain dengan jumlah_main < minPlays WAJIB didahulukan dibanding yang sudah >= minPlays.
   * 2. Di antara yang belum minPlays, urutkan dari jumlah_main paling sedikit.
   * 3. Jika jumlah_main sama, prioritaskan pemain yang tidak baru saja main.
   * 4. Jika masih sama, urutkan berdasarkan waktu istirahat / tie-break acak stabil.
   */
  function prioritizeQueue(queuePlayers = [], minPlays = 3) {
    return [...queuePlayers].sort((a, b) => {
      const playA = a.jumlah_main || 0;
      const playB = b.jumlah_main || 0;
      const quotaA = playA < minPlays ? 1 : 0;
      const quotaB = playB < minPlays ? 1 : 0;

      // Prioritas 1: Yang belum memenuhi kuota 3x (quota === 1) menang
      if (quotaA !== quotaB) {
        return quotaB - quotaA; // 1 sebelum 0
      }

      // Prioritas 2: Jumlah main paling sedikit
      if (playA !== playB) {
        return playA - playB;
      }

      // Prioritas 3: Rest count / id stabil
      return (a.id || 0) - (b.id || 0);
    });
  }

  /**
   * Memproses penyelesaian cooldown ketika sebuah match selesai di salah satu lapangan.
   */
  function processCooldownsOnMatchEnd(players = [], finishedPlayers = [], defaultCooldown = 1) {
    const finishedIds = new Set(finishedPlayers.map(p => p.id));

    players.forEach(p => {
      if (!p) return;
      if (finishedIds.has(p.id)) {
        // Cek apakah pemain berniat keluar setelah match
        if (p.leave_after_match) {
          p.status = PLAYER_STATUS.TIDAK_AKTIF;
          p.cooldown_remaining = 0;
        } else if (defaultCooldown > 0) {
          p.status = PLAYER_STATUS.ISTIRAHAT;
          p.cooldown_remaining = defaultCooldown;
        } else {
          p.status = PLAYER_STATUS.MENUNGGU;
          p.cooldown_remaining = 0;
        }
      } else if (p.status === PLAYER_STATUS.ISTIRAHAT) {
        // Kurangi cooldown pemain yang sedang istirahat saat ada match yang selesai
        p.cooldown_remaining = Math.max(0, (p.cooldown_remaining || 1) - 1);
        if (p.cooldown_remaining === 0) {
          p.status = PLAYER_STATUS.MENUNGGU;
        }
      }
    });

    return players;
  }

  // ── 4. FITUR 2: REQUEST REKAN TIM (MAX 1X) ──
  /**
   * Mengajukan permintaan berpasangan.
   */
  function submitPartnerRequest({
    requesterId,
    targetId,
    players = [],
    partnerRequests = [],
    partnerHistory = {}
  }) {
    const requester = players.find(p => p.id === requesterId);
    const target = players.find(p => p.id === targetId);

    if (!requester) {
      return { success: false, message: 'Pemain pemohon tidak ditemukan.' };
    }
    if (!target) {
      return { success: false, message: 'Pemain rekan yang dituju tidak ditemukan.' };
    }
    if (requesterId === targetId) {
      return { success: false, message: 'Tidak bisa request diri sendiri.' };
    }

    // Aturan kuota: maksimal 1x per pemain
    if (requester.request_used) {
      return {
        success: false,
        message: `Kuota request untuk ${requester.name} sudah habis (maksimal 1x per sesi).`
      };
    }

    // Cek status kedua pemain
    if (requester.status !== PLAYER_STATUS.MENUNGGU) {
      return {
        success: false,
        message: `Pemain pemohon (${requester.name}) saat ini sedang ${requester.status.replace('_', ' ')}.`
      };
    }
    if (target.status !== PLAYER_STATUS.MENUNGGU) {
      return {
        success: false,
        message: `Rekan yang dituju (${target.name}) saat ini sedang ${target.status.replace('_', ' ')}. Request hanya bisa saat keduanya berstatus menunggu.`
      };
    }

    // Cek apakah sudah pernah berpasangan (Aturan Poin 8 & Interaksi)
    const pairKey = getPairKey(requesterId, targetId);
    const timesPartnered = partnerHistory[pairKey] || 0;
    const hasPartneredBefore = timesPartnered > 0;

    const newRequest = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      requesterId,
      requesterName: requester.name,
      targetId,
      targetName: target.name,
      status: REQUEST_STATUS.APPROVED, // Otomatis siap jika target & requester berstatus menunggu, bisa disupervisi host
      hasPartneredBefore,
      timesPartnered,
      createdAt: Date.now()
    };

    // Tandai kuota request sudah digunakan
    requester.request_used = true;
    partnerRequests.push(newRequest);

    return {
      success: true,
      request: newRequest,
      warning: hasPartneredBefore
        ? `Perhatian: ${requester.name} dan ${target.name} sudah pernah berpasangan ${timesPartnered}x sebelumnya!`
        : null
    };
  }

  /**
   * Host membatalkan atau menolak request rekan tim.
   */
  function cancelOrRejectPartnerRequest(requestId, partnerRequests = [], players = []) {
    const req = partnerRequests.find(r => r.id === requestId);
    if (!req) return { success: false, message: 'Request tidak ditemukan.' };

    req.status = REQUEST_STATUS.CANCELLED;

    // Kembalikan kuota jika request dibatalkan host sebelum terpakai
    const requester = players.find(p => p.id === req.requesterId);
    if (requester) {
      requester.request_used = false;
    }

    return { success: true, request: req };
  }

  // ── 5. FITUR 8: PEMILIHAN REKAN BERBEDA & SMART TEAM BALANCER ──
  /**
   * Menghitung skor kualitas pairing untuk 4 pemain.
   * Menghindari rekan yang pernah bersama, Intermadiate & Advance dipisah,
   * serta memprioritaskan pasangan request jika ada.
   */
  function splitFourIntoTeamsSmart(
    fourPlayers,
    partnerHistory = {},
    opponentHistory = {},
    approvedRequests = []
  ) {
    if (!Array.isArray(fourPlayers) || fourPlayers.length < 4) {
      return {
        teamA: fourPlayers ? fourPlayers.slice(0, 2) : [],
        teamB: fourPlayers ? fourPlayers.slice(2, 4) : [],
        isRepeatedPartner: false
      };
    }

    const p = [...fourPlayers];
    const pairings = [
      { t1: [p[0], p[1]], t2: [p[2], p[3]] },
      { t1: [p[0], p[2]], t2: [p[1], p[3]] },
      { t1: [p[0], p[3]], t2: [p[1], p[2]] }
    ];

    // Cek apakah ada request rekan yang aktif di antara 4 pemain ini
    let forcedPairing = null;
    for (const req of approvedRequests) {
      if (req.status === REQUEST_STATUS.APPROVED) {
        const hasReq = p.some(x => x.id === req.requesterId);
        const hasTarget = p.some(x => x.id === req.targetId);
        if (hasReq && hasTarget) {
          // Cari kombinasi di mana requester dan target berada dalam tim yang sama
          const matchPair = pairings.find(pair => {
            const inT1 = pair.t1.some(x => x.id === req.requesterId) && pair.t1.some(x => x.id === req.targetId);
            const inT2 = pair.t2.some(x => x.id === req.requesterId) && pair.t2.some(x => x.id === req.targetId);
            return inT1 || inT2;
          });
          if (matchPair) {
            forcedPairing = { pair: matchPair, request: req };
            break;
          }
        }
      }
    }

    // Aturan Wajib: Role Intermadiate dan Advance TIDAK BOLEH 1 tim
    let validPairings = pairings.filter(pair =>
      !hasInterAndAdvanceTogether(pair.t1) && !hasInterAndAdvanceTogether(pair.t2)
    );

    // Fallback jika semua kombinasi melanggar aturan role (misal 3 Adv + 1 Inter)
    if (validPairings.length === 0) {
      validPairings = pairings;
    }

    // Jika ada pasangan yang di-request khusus, utamakan jika tidak melanggar role
    if (forcedPairing) {
      const isRoleSafe = !hasInterAndAdvanceTogether(forcedPairing.pair.t1) && !hasInterAndAdvanceTogether(forcedPairing.pair.t2);
      if (isRoleSafe || validPairings.length === pairings.length) {
        const teamA = [...forcedPairing.pair.t1];
        const teamB = [...forcedPairing.pair.t2];
        const k1 = getPairKey(teamA[0].id, teamA[1].id);
        const k2 = getPairKey(teamB[0].id, teamB[1].id);
        const isRepeated = (partnerHistory[k1] || 0) > 0 || (partnerHistory[k2] || 0) > 0;
        return {
          teamA,
          teamB,
          isRepeatedPartner: isRepeated,
          usedRequest: forcedPairing.request
        };
      }
    }

    // Prioritaskan pisahkan 2 Advance jika ada
    const advCount = p.filter(isAdvanceRole).length;
    if (advCount === 2) {
      const separatedAdv = validPairings.filter(pair =>
        pair.t1.filter(isAdvanceRole).length === 1 && pair.t2.filter(isAdvanceRole).length === 1
      );
      if (separatedAdv.length > 0) validPairings = separatedAdv;
    }

    // Hitung penalti riwayat berpasangan (partnerHistory) dan lawan (opponentHistory)
    const scoredPairings = validPairings.map(pair => {
      let partnerPenalty = 0;
      let opponentPenalty = 0;

      // Penalti partner
      if (pair.t1[0] && pair.t1[1]) {
        const k1 = getPairKey(pair.t1[0].id, pair.t1[1].id);
        partnerPenalty += (partnerHistory[k1] || 0) * 100; // Bobot sangat tinggi agar tidak berulang
      }
      if (pair.t2[0] && pair.t2[1]) {
        const k2 = getPairKey(pair.t2[0].id, pair.t2[1].id);
        partnerPenalty += (partnerHistory[k2] || 0) * 100;
      }

      // Penalti lawan berulang (prioritas lebih rendah)
      [pair.t1[0], pair.t1[1]].forEach(p1 => {
        [pair.t2[0], pair.t2[1]].forEach(p2 => {
          if (p1 && p2) {
            const kOpp = getPairKey(p1.id, p2.id);
            opponentPenalty += (opponentHistory[kOpp] || 0) * 5;
          }
        });
      });

      return {
        pair,
        partnerPenalty,
        totalPenalty: partnerPenalty + opponentPenalty
      };
    });

    scoredPairings.sort((a, b) => a.totalPenalty - b.totalPenalty);
    const best = scoredPairings[0];

    let teamA = [...best.pair.t1];
    let teamB = [...best.pair.t2];
    const isRepeatedPartner = best.partnerPenalty > 0;

    return {
      teamA,
      teamB,
      isRepeatedPartner,
      usedRequest: null
    };
  }

  /**
   * Memilih 4 pemain yang kompatibel dari antrian 'menunggu'.
   * Mengutamakan yang memiliki kuota request pasangan terlebih dahulu.
   */
  function pickNextFourPlayersForMatch(
    eligibleQueue = [],
    partnerRequests = [],
    partnerHistory = {}
  ) {
    if (eligibleQueue.length < 4) return null;

    // 1. Cek apakah ada request pasangan yang disetujui dan kedua pemainnya ada di antrian
    const queueMap = new Map(eligibleQueue.map(p => [p.id, p]));
    let reqPair = null;

    for (const req of partnerRequests) {
      if (req.status === REQUEST_STATUS.APPROVED) {
        if (queueMap.has(req.requesterId) && queueMap.has(req.targetId)) {
          reqPair = [queueMap.get(req.requesterId), queueMap.get(req.targetId)];
          break;
        }
      }
    }

    if (reqPair) {
      const selected = [...reqPair];
      const selectedIds = new Set(selected.map(p => p.id));
      const remaining = eligibleQueue.filter(p => !selectedIds.has(p.id));
      for (const p of remaining) {
        if (selected.length === 4) break;
        selected.push(p);
      }
      return selected;
    }

    // 2. Jika tidak ada request pasangan, ambil 4 pemain teratas dari antrian yang sudah diprioritaskan
    return eligibleQueue.slice(0, 4);
  }

  // ── 6. FITUR 5: PROPOSAL JADWAL MASUK LAPANGAN & WORKFLOW ACC HOST ──
  /**
   * Menyiapkan usulan match untuk lapangan tertentu dengan status 'menunggu_acc'.
   * Menghasilkan informasi info main tiap pemain dan riwayat pasangan.
   */
  function createCourtProposal({
    courtNumber,
    courtName,
    players = [],
    partnerHistory = {},
    opponentHistory = {},
    partnerRequests = [],
    minPlays = 3
  }) {
    const queue = prioritizeQueue(getEligibleQueue(players), minPlays);
    if (queue.length < 4) {
      return {
        court: {
          courtNumber,
          courtName: courtName || `Lapangan ${courtNumber}`,
          status: COURT_STATUS.KOSONG,
          category: 'TERBUKA',
          categoryLabel: 'Belum Ada Pemain',
          teamA: [],
          teamB: [],
          scoreA: null,
          scoreB: null,
          winner: null,
          shuttlecocks: { baru: 0, bekas_layak: 0, bekas_dihasilkan: 0 }
        },
        message: 'Jumlah pemain berstatus menunggu kurang dari 4 orang.'
      };
    }

    const four = pickNextFourPlayersForMatch(queue, partnerRequests, partnerHistory);
    const split = splitFourIntoTeamsSmart(four, partnerHistory, opponentHistory, partnerRequests);

    const hasFemale = four.some(p => p.gender === 'P');
    const allFemale = four.every(p => p.gender === 'P');
    const category = allFemale ? 'PUTRI' : (hasFemale ? 'CAMPURAN' : 'PUTRA');
    const categoryLabel = allFemale ? 'Putri vs Putri' : (hasFemale ? 'Terbuka / Campuran' : 'Ganda Putra');

    // Buat metadata ringkasan untuk host sebelum ACC
    const playerSummaries = four.map(p => {
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        gender: p.gender,
        jumlah_main: p.jumlah_main || 0,
        quotaMet: (p.jumlah_main || 0) >= minPlays
      };
    });

    const kA = getPairKey(split.teamA[0].id, split.teamA[1].id);
    const kB = getPairKey(split.teamB[0].id, split.teamB[1].id);
    const historyA = partnerHistory[kA] || 0;
    const historyB = partnerHistory[kB] || 0;

    const court = {
      courtNumber,
      courtName: courtName || `Lapangan ${courtNumber}`,
      status: COURT_STATUS.MENUNGGU_ACC,
      category,
      categoryLabel,
      teamA: split.teamA,
      teamB: split.teamB,
      scoreA: null,
      scoreB: null,
      winner: null,
      isRepeatedPartner: split.isRepeatedPartner,
      partnerDetails: {
        teamAPairHistory: historyA,
        teamBPairHistory: historyB,
        hasRepeatedInTeamA: historyA > 0,
        hasRepeatedInTeamB: historyB > 0
      },
      playerSummaries,
      usedRequest: split.usedRequest || null,
      shuttlecocks: { baru: 0, bekas_layak: 0, bekas_dihasilkan: 0 },
      proposedAt: Date.now()
    };

    return { court, message: 'Usulan pertandingan berhasil dibuat dan menunggu persetujuan Host.' };
  }

  /**
   * Host menekan tombol ACC: Pemain resmi menjadi 'di_lapangan' dan court menjadi 'sedang_main'.
   */
  function approveCourtProposal(court, players = [], partnerRequests = []) {
    if (!court || court.status !== COURT_STATUS.MENUNGGU_ACC) {
      return { success: false, message: 'Status lapangan bukan menunggu ACC.' };
    }

    const matchPlayers = [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean);
    if (matchPlayers.length < 4) {
      return { success: false, message: 'Pemain di lapangan ini kurang dari 4 orang.' };
    }

    // Cek apakah ada pemain yang tidak sengaja sudah di lapangan lain
    const busyPlayer = matchPlayers.find(mp => {
      const found = players.find(p => p.id === mp.id);
      return found && found.status === PLAYER_STATUS.DI_LAPANGAN;
    });

    if (busyPlayer) {
      return {
        success: false,
        message: `Pemain ${busyPlayer.name} sudah sedang bermain di lapangan lain.`
      };
    }

    // Ubah status pemain menjadi di_lapangan
    matchPlayers.forEach(mp => {
      const found = players.find(p => p.id === mp.id);
      if (found) {
        found.status = PLAYER_STATUS.DI_LAPANGAN;
      }
    });

    // Tandai request rekan tim sebagai selesai jika digunakan
    if (court.usedRequest) {
      const req = partnerRequests.find(r => r.id === court.usedRequest.id);
      if (req) {
        req.status = REQUEST_STATUS.COMPLETED;
      }
    }

    court.status = COURT_STATUS.SEDANG_MAIN;
    court.startedAt = Date.now();

    return { success: true, court };
  }

  /**
   * Host menolak usulan: Pemain kembali ke status 'menunggu', lapangan menjadi 'kosong'.
   */
  function rejectCourtProposal(court, players = []) {
    if (!court) return { success: false };

    const matchPlayers = [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean);
    matchPlayers.forEach(mp => {
      const found = players.find(p => p.id === mp.id);
      if (found && found.status !== PLAYER_STATUS.TIDAK_AKTIF) {
        found.status = PLAYER_STATUS.MENUNGGU;
      }
    });

    court.status = COURT_STATUS.KOSONG;
    court.teamA = [];
    court.teamB = [];
    court.scoreA = null;
    court.scoreB = null;
    court.winner = null;
    court.playerSummaries = null;
    court.usedRequest = null;

    return { success: true, court };
  }

  // ── 7. FITUR 4: INPUT SKOR LANGSUNG & KLASEMEN REAL-TIME ──
  /**
   * Validasi skor pertandingan bulutangkis.
   */
  function validateBadmintonScore(scoreA, scoreB, winner) {
    const sA = Number(scoreA);
    const sB = Number(scoreB);

    if (isNaN(sA) || isNaN(sB)) {
      return { valid: false, message: 'Skor harus berupa angka valid.' };
    }
    if (sA < 0 || sB < 0) {
      return { valid: false, message: 'Skor tidak boleh negatif.' };
    }
    if (sA === sB) {
      return { valid: false, message: 'Pertandingan bulu tangkis tidak boleh berakhir seri (skor sama).' };
    }

    const declaredWinner = winner || (sA > sB ? 'A' : 'B');
    if (declaredWinner === 'A' && sA <= sB) {
      return { valid: false, message: 'Pemenang Tim A harus memiliki skor lebih tinggi dari Tim B.' };
    }
    if (declaredWinner === 'B' && sB <= sA) {
      return { valid: false, message: 'Pemenang Tim B harus memiliki skor lebih tinggi dari Tim A.' };
    }

    return {
      valid: true,
      scoreA: sA,
      scoreB: sB,
      winner: declaredWinner
    };
  }

  /**
   * Menyimpan skor pertandingan yang baru selesai dan mengupdate jumlah_main,
   * partner_history, cooldown pemain, serta membebaskan lapangan menjadi 'kosong'.
   */
  function recordMatchFinished({
    court,
    scoreA,
    scoreB,
    winner,
    players = [],
    partnerHistory = {},
    opponentHistory = {},
    shuttlecocks = null,
    defaultCooldown = 1,
    inventory = null
  }) {
    const validation = validateBadmintonScore(scoreA, scoreB, winner);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    const wasAlreadyFinished = court.status === COURT_STATUS.FINISHED;

    court.scoreA = validation.scoreA;
    court.scoreB = validation.scoreB;
    court.winner = validation.winner;
    court.status = COURT_STATUS.FINISHED;
    court.finishedAt = Date.now();

    if (shuttlecocks) {
      court.shuttlecocks = {
        baru: Number(shuttlecocks.baru) || 0,
        bekas_layak: Number(shuttlecocks.bekas_layak) || 0,
        bekas_dihasilkan: Number(shuttlecocks.bekas_dihasilkan) || 0
      };

      // Update stok inventaris jika ada
      if (inventory) {
        inventory.terpakaiBaru = (inventory.terpakaiBaru || 0) + court.shuttlecocks.baru;
        inventory.terpakaiBekas = (inventory.terpakaiBekas || 0) + court.shuttlecocks.bekas_layak;
        inventory.bekasLayakDidapat = (inventory.bekasLayakDidapat || 0) + court.shuttlecocks.bekas_dihasilkan;
      }
    }

    const teamA = (court.teamA || []).filter(Boolean);
    const teamB = (court.teamB || []).filter(Boolean);
    const allCourtPlayers = [...teamA, ...teamB];

    // Jika ini bukan edit skor dari match yang sudah dihitung sebelumnya:
    if (!wasAlreadyFinished) {
      // 1. Tambah counter jumlah_main pemain
      allCourtPlayers.forEach(cp => {
        const p = players.find(x => x.id === cp.id);
        if (p) {
          p.jumlah_main = (p.jumlah_main || 0) + 1;
        }
      });

      // 2. Tambah partner history
      if (teamA.length >= 2) {
        const kA = getPairKey(teamA[0].id, teamA[1].id);
        partnerHistory[kA] = (partnerHistory[kA] || 0) + 1;
      }
      if (teamB.length >= 2) {
        const kB = getPairKey(teamB[0].id, teamB[1].id);
        partnerHistory[kB] = (partnerHistory[kB] || 0) + 1;
      }

      // 3. Tambah opponent history
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          const kOpp = getPairKey(pA.id, pB.id);
          opponentHistory[kOpp] = (opponentHistory[kOpp] || 0) + 1;
        });
      });

      // 4. Proses cooldown pemain
      processCooldownsOnMatchEnd(players, allCourtPlayers, defaultCooldown);
    }

    return {
      success: true,
      court,
      finishedMatch: { ...court }
    };
  }

  /**
   * Edit skor pertandingan lama tanpa menduplikasi jumlah_main atau partner_history.
   */
  function editFinishedMatchScore({
    court,
    newScoreA,
    newScoreB,
    newWinner
  }) {
    const validation = validateBadmintonScore(newScoreA, newScoreB, newWinner);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    court.scoreA = validation.scoreA;
    court.scoreB = validation.scoreB;
    court.winner = validation.winner;

    return { success: true, court };
  }

  /**
   * Menghitung klasemen real-time secara inkremental dan deterministik
   * berdasarkan regulasi resmi (Wins -> Diff -> Total Points -> H2H).
   */
  function calculateStandings(players = [], schedule = [], sortMode = 'wins') {
    const stats = {};

    players.forEach(p => {
      if (!p) return;
      stats[p.id] = {
        player: p,
        id: p.id,
        name: p.name,
        role: p.role,
        gender: p.gender,
        status: p.status,
        is_deleted: !!p.is_deleted,
        leave_after_match: !!p.leave_after_match,
        wins: 0,
        losses: 0,
        matches: 0,
        scored: 0,
        conceded: 0,
        diff: 0,
        totalScore: 0,
        winRate: 0,
        jumlah_main: p.jumlah_main || 0,
        titles: p.titles || 0,
        tieBreakNote: ''
      };
    });

    const h2hMatrix = {};
    players.forEach(p1 => {
      h2hMatrix[p1.id] = {};
      players.forEach(p2 => { h2hMatrix[p1.id][p2.id] = 0; });
    });

    schedule.forEach(round => {
      if (!round) return;
      const allCourts = [...(round.courts || []), ...(round.finishedCourts || [])];
      allCourts.forEach(c => {
        if (!c || c.status !== 'finished') return;
        const sA = Number(c.scoreA) || 0;
        const sB = Number(c.scoreB) || 0;
        const isWinA = c.winner === 'A';
        const isWinB = c.winner === 'B';

        const teamA = (c.teamA || []).filter(Boolean);
        const teamB = (c.teamB || []).filter(Boolean);

        teamA.forEach(p => {
          if (!p || !stats[p.id]) return;
          stats[p.id].matches++;
          stats[p.id].scored += sA;
          stats[p.id].conceded += sB;
          if (isWinA) stats[p.id].wins++;
          else if (isWinB) stats[p.id].losses++;
        });

        teamB.forEach(p => {
          if (!p || !stats[p.id]) return;
          stats[p.id].matches++;
          stats[p.id].scored += sB;
          stats[p.id].conceded += sA;
          if (isWinB) stats[p.id].wins++;
          else if (isWinA) stats[p.id].losses++;
        });

        // H2H Matrix
        if (isWinA) {
          teamA.forEach(pA => {
            teamB.forEach(pB => {
              if (h2hMatrix[pA.id] && h2hMatrix[pA.id][pB.id] !== undefined) {
                h2hMatrix[pA.id][pB.id] += 1;
              }
              if (h2hMatrix[pB.id] && h2hMatrix[pB.id][pA.id] !== undefined) {
                h2hMatrix[pB.id][pA.id] -= 1;
              }
            });
          });
        } else if (isWinB) {
          teamB.forEach(pB => {
            teamA.forEach(pA => {
              if (h2hMatrix[pB.id] && h2hMatrix[pB.id][pA.id] !== undefined) {
                h2hMatrix[pB.id][pA.id] += 1;
              }
              if (h2hMatrix[pA.id] && h2hMatrix[pA.id][pB.id] !== undefined) {
                h2hMatrix[pA.id][pB.id] -= 1;
              }
            });
          });
        }
      });
    });

    const list = Object.values(stats).map(s => {
      s.diff = s.scored - s.conceded;
      s.totalScore = s.scored;
      s.winRate = s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0;
      return s;
    });

    const getH2H = (p1, p2) => {
      if (!h2hMatrix[p1.id] || h2hMatrix[p1.id][p2.id] === undefined) return 0;
      const diff = h2hMatrix[p1.id][p2.id];
      if (diff > 0) return 1;
      if (diff < 0) return -1;
      return 0;
    };

    // Pengurutan klasemen
    if (sortMode === 'points') {
      return list.sort((a, b) => b.totalScore - a.totalScore || b.diff - a.diff || b.wins - a.wins);
    } else if (sortMode === 'diff') {
      return list.sort((a, b) => b.diff - a.diff || b.wins - a.wins || b.totalScore - a.totalScore);
    } else if (sortMode === 'wr') {
      return list.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.diff - a.diff || b.totalScore - a.totalScore);
    }

    // Default: Wins -> Diff -> Total Poin -> H2H
    return list.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      const h2h = getH2H(a, b);
      if (h2h !== 0) return -h2h;
      return (b.titles || 0) - (a.titles || 0);
    });
  }

  // ── 8. FITUR 3: PENANGANAN TAMBAH & SOFT DELETE PEMAIN ──
  /**
   * Menambahkan pemain baru di tengah sesi tanpa mereset data.
   */
  function addPlayerIncremental(players = [], newPlayerData = {}) {
    const newPlayer = {
      id: newPlayerData.id || (Date.now() + Math.floor(Math.random() * 1000)),
      name: (newPlayerData.name || '').trim(),
      gender: newPlayerData.gender || 'L',
      role: newPlayerData.role || 'Intermadiate',
      paid: true,
      status: PLAYER_STATUS.MENUNGGU,
      jumlah_main: 0,
      request_used: false,
      cooldown_remaining: 0,
      leave_after_match: false,
      is_deleted: false,
      createdAt: Date.now()
    };

    players.push(newPlayer);
    return newPlayer;
  }

  /**
   * Mengurangi pemain di tengah sesi tanpa menghapus histori skor/klasemen.
   */
  function removePlayerIncremental(playerId, players = [], activeCourts = []) {
    const player = players.find(p => p.id === playerId);
    if (!player) return { success: false, message: 'Pemain tidak ditemukan.' };

    // Cek apakah pemain sedang bermain di lapangan aktif
    const isCurrentlyPlaying = activeCourts.some(c => {
      if (!c || c.status === COURT_STATUS.FINISHED) return false;
      const courtPlayers = [...(c.teamA || []), ...(c.teamB || [])].filter(Boolean);
      return courtPlayers.some(p => p.id === playerId);
    });

    if (isCurrentlyPlaying) {
      // Tandai keluar setelah match selesai
      player.leave_after_match = true;
      return {
        success: true,
        mode: 'leave_after_match',
        message: `${player.name} sedang bertanding di lapangan. Ditandai akan keluar otomatis setelah pertandingannya selesai.`
      };
    }

    // Jika sedang menunggu atau istirahat, segera nonaktifkan
    player.status = PLAYER_STATUS.TIDAK_AKTIF;
    player.is_deleted = true;
    player.cooldown_remaining = 0;

    return {
      success: true,
      mode: 'immediate_inactive',
      message: `${player.name} telah dikeluarkan dari antrian (status: Tidak Aktif). Histori skor dan klasemen tetap tersimpan.`
    };
  }

  // ── 9. FITUR 6: MONITORING & MANAJEMEN KOK ──
  function createDefaultShuttlecockInventory(stokAwalBaru = 24, stokAwalBekas = 12) {
    return {
      stokAwalBaru: Number(stokAwalBaru) || 0,
      stokAwalBekas: Number(stokAwalBekas) || 0,
      terpakaiBaru: 0,
      terpakaiBekas: 0,
      bekasLayakDidapat: 0
    };
  }

  function getShuttlecockSummary(schedule = [], inventory = null) {
    let terpakaiBaru = 0;
    let terpakaiBekas = 0;
    let bekasLayakDidapat = 0;
    const perCourtUsage = {};

    schedule.forEach(round => {
      if (!round) return;
      const allCourts = [...(round.courts || []), ...(round.finishedCourts || [])];
      allCourts.forEach(c => {
        if (!c) return;
        const sh = c.shuttlecocks || { baru: 0, bekas_layak: 0, bekas_dihasilkan: 0 };
        const b = Number(sh.baru) || 0;
        const u = Number(sh.bekas_layak) || 0;
        const r = Number(sh.bekas_dihasilkan) || 0;

        terpakaiBaru += b;
        terpakaiBekas += u;
        bekasLayakDidapat += r;

        const cName = c.courtName || `Lapangan ${c.courtNumber}`;
        if (!perCourtUsage[cName]) {
          perCourtUsage[cName] = { baru: 0, bekas_layak: 0, total: 0 };
        }
        perCourtUsage[cName].baru += b;
        perCourtUsage[cName].bekas_layak += u;
        perCourtUsage[cName].total += (b + u);
      });
    });

    const inv = inventory || createDefaultShuttlecockInventory();
    const sisaBaru = Math.max(0, inv.stokAwalBaru - terpakaiBaru);
    const sisaBekas = Math.max(0, inv.stokAwalBekas - terpakaiBekas + bekasLayakDidapat);

    return {
      terpakaiBaru,
      terpakaiBekas,
      totalTerpakai: terpakaiBaru + terpakaiBekas,
      bekasLayakDidapat,
      sisaBaru,
      sisaBekas,
      perCourtUsage
    };
  }

  // ── 10. AUDIT LOGGING OVERRIDE ──
  function logHostAction(auditLogs = [], action, details = {}, hostName = 'Host') {
    const entry = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      timestamp: Date.now(),
      action,
      details,
      hostName
    };
    auditLogs.push(entry);
    return entry;
  }

  // ── EXPORT INTERFACE ──
  return {
    PLAYER_STATUS,
    COURT_STATUS,
    REQUEST_STATUS,
    getPairKey,
    isIntermediateRole,
    isAdvanceRole,
    hasInterAndAdvanceTogether,
    backfillPlayerStats,
    syncActivePlayerStatuses,
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
    createDefaultShuttlecockInventory,
    getShuttlecockSummary,
    logHostAction
  };
});
