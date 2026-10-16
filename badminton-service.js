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
   * Q-4: Gunakan perbandingan string untuk id non-numerik.
   */
  function getPairKey(id1, id2) {
    const isNum1 = typeof id1 === 'number' || (typeof id1 === 'string' && id1.trim() !== '' && !Number.isNaN(Number(id1)));
    const isNum2 = typeof id2 === 'number' || (typeof id2 === 'string' && id2.trim() !== '' && !Number.isNaN(Number(id2)));

    if (isNum1 && isNum2) {
      const a = Number(id1);
      const b = Number(id2);
      return a < b ? `${a}-${b}` : `${b}-${a}`;
    }

    const s1 = String(id1);
    const s2 = String(id2);
    return s1 < s2 ? `${s1}-${s2}` : `${s2}-${s1}`;
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
        // Tetap dipertahankan statusnya
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

      // Prioritas 3: Q-3 Tie-break berdasarkan waktu mulai menunggu (waitingSince)
      // Pemain yang menunggu lebih lama (timestamp lebih kecil) didahulukan
      const waitA = typeof a.waitingSince === 'number' ? a.waitingSince : 0;
      const waitB = typeof b.waitingSince === 'number' ? b.waitingSince : 0;
      if (waitA !== waitB) {
        return waitA - waitB;
      }

      // Prioritas 4: Tie-break id stabil
      if (typeof a.id === 'string' && typeof b.id === 'string') {
        return a.id.localeCompare(b.id);
      }
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  }

  function cancelRequestsForPlayer(playerId, players = [], partnerRequests = []) {
    if (!partnerRequests || !Array.isArray(partnerRequests)) return;
    const pIdStr = String(playerId);
    partnerRequests.forEach(req => {
      if (!req || (req.status !== REQUEST_STATUS.PENDING && req.status !== REQUEST_STATUS.APPROVED)) return;
      if (String(req.requesterId) === pIdStr || String(req.targetId) === pIdStr) {
        req.status = REQUEST_STATUS.CANCELLED;
        if (String(req.requesterId) !== pIdStr) {
          const reqPlayer = players.find(p => String(p.id) === String(req.requesterId));
          if (reqPlayer) {
            reqPlayer.request_used = false;
          }
        }
      }
    });
  }

  /**
   * Memproses penyelesaian cooldown ketika sebuah match selesai di salah satu lapangan.
   */
  function processCooldownsOnMatchEnd(players = [], finishedPlayers = [], defaultCooldown = 1, partnerRequests = []) {
    const finishedIds = new Set(finishedPlayers.map(p => String(p.id)));

    players.forEach(p => {
      if (!p) return;
      if (finishedIds.has(String(p.id))) {
        // Cek apakah pemain berniat keluar setelah match
        if (p.leave_after_match) {
          p.status = PLAYER_STATUS.TIDAK_AKTIF;
          p.is_deleted = true;
          p.cooldown_remaining = 0;
          cancelRequestsForPlayer(p.id, players, partnerRequests);
        } else if (defaultCooldown > 0) {
          p.status = PLAYER_STATUS.ISTIRAHAT;
          p.cooldown_remaining = defaultCooldown;
        } else {
          p.status = PLAYER_STATUS.MENUNGGU;
          p.cooldown_remaining = 0;
          p.waitingSince = Date.now();
        }
      } else if (p.status === PLAYER_STATUS.ISTIRAHAT) {
        // Kurangi cooldown pemain yang sedang istirahat saat ada match yang selesai
        p.cooldown_remaining = Math.max(0, (p.cooldown_remaining || 1) - 1);
        if (p.cooldown_remaining === 0) {
          p.status = PLAYER_STATUS.MENUNGGU;
          p.waitingSince = Date.now();
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
    const reqIdStr = String(requesterId);
    const tgtIdStr = String(targetId);
    const requester = players.find(p => String(p.id) === reqIdStr);
    const target = players.find(p => String(p.id) === tgtIdStr);

    if (!requester) {
      return { success: false, message: 'Pemain pemohon tidak ditemukan.' };
    }
    if (!target) {
      return { success: false, message: 'Pemain rekan yang dituju tidak ditemukan.' };
    }
    if (reqIdStr === tgtIdStr) {
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

    // Cek apakah pemain memiliki kombinasi role terlarang (Intermediate & Advance tidak boleh 1 tim)
    if (hasInterAndAdvanceTogether([requester, target])) {
      return {
        success: false,
        message: 'Regulasi melarang pemain level Intermediate dan Advance berpasangan dalam satu tim.'
      };
    }

    // Cek apakah sudah ada request aktif yang melibatkan requester atau target
    const duplicateOrConflicting = partnerRequests.find(r => {
      if (!r || (r.status !== REQUEST_STATUS.PENDING && r.status !== REQUEST_STATUS.APPROVED)) return false;
      const rReq = String(r.requesterId);
      const rTgt = String(r.targetId);
      return rReq === reqIdStr || rTgt === reqIdStr || rReq === tgtIdStr || rTgt === tgtIdStr;
    });

    if (duplicateOrConflicting) {
      const isTargetBusy = String(duplicateOrConflicting.requesterId) === tgtIdStr || String(duplicateOrConflicting.targetId) === tgtIdStr;
      return {
        success: false,
        message: isTargetBusy
          ? `${target.name} sudah memiliki request pasangan aktif yang menunggu jadwal bermain.`
          : `${requester.name} sudah memiliki request pasangan aktif yang belum diselesaikan.`
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
    const reqIdStr = String(requestId);
    const req = partnerRequests.find(r => String(r.id) === reqIdStr);
    if (!req) return { success: false, message: 'Request tidak ditemukan.' };

    req.status = REQUEST_STATUS.CANCELLED;

    // Kembalikan kuota jika request dibatalkan host sebelum terpakai
    const requester = players.find(p => String(p.id) === String(req.requesterId));
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

        const usedRequests = [];
        if (Array.isArray(approvedRequests)) {
          approvedRequests.forEach(req => {
            if (!req || req.status !== REQUEST_STATUS.APPROVED) return;
            const inA = teamA.some(x => x.id === req.requesterId) && teamA.some(x => x.id === req.targetId);
            const inB = teamB.some(x => x.id === req.requesterId) && teamB.some(x => x.id === req.targetId);
            if (inA || inB) {
              usedRequests.push(req);
            }
          });
        }
        if (usedRequests.length === 0 && forcedPairing.request) {
          usedRequests.push(forcedPairing.request);
        }

        return {
          teamA,
          teamB,
          isRepeatedPartner: isRepeated,
          usedRequest: usedRequests[0] || forcedPairing.request,
          usedRequests
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

    // Cek semua request berstatus APPROVED yang terpasang dalam tim A atau tim B
    const usedRequests = [];
    if (Array.isArray(approvedRequests)) {
      approvedRequests.forEach(req => {
        if (!req || req.status !== REQUEST_STATUS.APPROVED) return;
        const inA = teamA.some(x => x.id === req.requesterId) && teamA.some(x => x.id === req.targetId);
        const inB = teamB.some(x => x.id === req.requesterId) && teamB.some(x => x.id === req.targetId);
        if (inA || inB) {
          usedRequests.push(req);
        }
      });
    }

    return {
      teamA,
      teamB,
      isRepeatedPartner,
      usedRequest: usedRequests[0] || null,
      usedRequests
    };
  }

  /**
   * Memilih 4 pemain yang kompatibel dari antrian 'menunggu'.
   * Mengutamakan yang memiliki kuota request pasangan terlebih dahulu.
   */
  function pickNextFourPlayersForMatch(
    eligibleQueue = [],
    partnerRequests = [],
    partnerHistory = {},
    allPlayers = []
  ) {
    if (eligibleQueue.length < 4) return null;

    // 1. Cek apakah ada request pasangan yang disetujui dan kedua pemainnya ada di antrian
    const queueMap = new Map(eligibleQueue.map(p => [p.id, p]));
    let reqPair = null;

    const approvedReqs = (partnerRequests || []).filter(req => req && req.status === REQUEST_STATUS.APPROVED);

    // Prioritaskan request game pertama (salah satu pemain jumlah_main === 0)
    approvedReqs.sort((a, b) => {
      const pA1 = allPlayers.length ? allPlayers.find(p => String(p.id) === String(a.requesterId)) : queueMap.get(a.requesterId);
      const pA2 = allPlayers.length ? allPlayers.find(p => String(p.id) === String(a.targetId)) : queueMap.get(a.targetId);
      const pB1 = allPlayers.length ? allPlayers.find(p => String(p.id) === String(b.requesterId)) : queueMap.get(b.requesterId);
      const pB2 = allPlayers.length ? allPlayers.find(p => String(p.id) === String(b.targetId)) : queueMap.get(b.targetId);
      const isGame1A = (pA1 && (pA1.jumlah_main || 0) === 0) || (pA2 && (pA2.jumlah_main || 0) === 0);
      const isGame1B = (pB1 && (pB1.jumlah_main || 0) === 0) || (pB2 && (pB2.jumlah_main || 0) === 0);
      if (isGame1A && !isGame1B) return -1;
      if (!isGame1A && isGame1B) return 1;
      const minPlayA = Math.min(pA1 ? (pA1.jumlah_main || 0) : 0, pA2 ? (pA2.jumlah_main || 0) : 0);
      const minPlayB = Math.min(pB1 ? (pB1.jumlah_main || 0) : 0, pB2 ? (pB2.jumlah_main || 0) : 0);
      return minPlayA - minPlayB;
    });

    for (const req of approvedReqs) {
      // Cek jika requester atau target sudah tidak aktif atau terhapus
      const reqP = allPlayers.length ? allPlayers.find(p => p.id === req.requesterId) : queueMap.get(req.requesterId);
      const tgtP = allPlayers.length ? allPlayers.find(p => p.id === req.targetId) : queueMap.get(req.targetId);
      if ((reqP && (reqP.status === PLAYER_STATUS.TIDAK_AKTIF || reqP.is_deleted)) ||
          (tgtP && (tgtP.status === PLAYER_STATUS.TIDAK_AKTIF || tgtP.is_deleted))) {
        req.status = REQUEST_STATUS.CANCELLED;
        if (reqP && reqP.status !== PLAYER_STATUS.TIDAK_AKTIF && !reqP.is_deleted) {
          reqP.request_used = false;
        }
        continue;
      }

      if (queueMap.has(req.requesterId) && queueMap.has(req.targetId)) {
        reqPair = [queueMap.get(req.requesterId), queueMap.get(req.targetId)];
        break;
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

    // Cegah pemain yang memiliki request game 1 terpasang dengan pemain acak
    // jika pasangannya belum ada di antrian dan masih ada 4 pemain lain yang siap bermain
    const playersWaitingForPartner = new Set();
    approvedReqs.forEach(req => {
      const hasReq = queueMap.has(req.requesterId);
      const hasTgt = queueMap.has(req.targetId);
      if (hasReq !== hasTgt) {
        const waitingId = hasReq ? req.requesterId : req.targetId;
        const waitingP = queueMap.get(waitingId);
        if (waitingP && (waitingP.jumlah_main || 0) === 0) {
          playersWaitingForPartner.add(String(waitingId));
        }
      }
    });

    let availablePool = eligibleQueue;
    if (playersWaitingForPartner.size > 0) {
      const filteredPool = eligibleQueue.filter(p => !playersWaitingForPartner.has(String(p.id)));
      if (filteredPool.length >= 4) {
        availablePool = filteredPool;
      }
    }

    // 2. Gender-aware selection (Q-3):
    // a) Bila >= 4 pemain putri menunggu, buat match khusus putri (4 pemain putri)
    const femalePlayers = availablePool.filter(p => p && p.gender === 'P');
    if (femalePlayers.length >= 4) {
      return femalePlayers.slice(0, 4);
    }

    // b) Ambil 4 pemain teratas dari antrian yang sudah diprioritaskan
    let candidateFour = availablePool.slice(0, 4);
    const femalesInCandidate = candidateFour.filter(p => p && p.gender === 'P');

    // c) Hindari 3 putra + 1 putri jika ada alternatif putra di sisa antrian (kecuali putri berlevel Advance yang dapat masuk match terbuka)
    if (femalesInCandidate.length === 1 && !isAdvanceRole(femalesInCandidate[0])) {
      const remainingMales = availablePool.slice(4).filter(p => p && p.gender !== 'P');
      if (remainingMales.length > 0) {
        candidateFour = candidateFour.filter(p => String(p.id) !== String(femalesInCandidate[0].id));
        candidateFour.push(remainingMales[0]);
      }
    }

    return candidateFour;
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
    let queue = prioritizeQueue(getEligibleQueue(players), minPlays);
    let cooldownReleased = false;

    // BUG-1: Cegah deadlock cooldown jika antrian < 4 namun (menunggu + istirahat) >= 4
    if (queue.length < 4) {
      const restingPlayers = players.filter(p => p && p.status === PLAYER_STATUS.ISTIRAHAT && !p.is_deleted);
      if (queue.length + restingPlayers.length >= 4) {
        restingPlayers.sort((a, b) => {
          const cdA = typeof a.cooldown_remaining === 'number' ? a.cooldown_remaining : 0;
          const cdB = typeof b.cooldown_remaining === 'number' ? b.cooldown_remaining : 0;
          if (cdA !== cdB) return cdA - cdB;
          const playA = a.jumlah_main || 0;
          const playB = b.jumlah_main || 0;
          if (playA !== playB) return playA - playB;
          return (a.id || 0) - (b.id || 0);
        });

        const needed = 4 - queue.length;
        const released = restingPlayers.slice(0, needed);
        released.forEach(p => {
          p.status = PLAYER_STATUS.MENUNGGU;
          p.cooldown_remaining = 0;
          p.cooldownReleased = true;
          p.waitingSince = Date.now();
        });
        cooldownReleased = true;

        queue = prioritizeQueue(getEligibleQueue(players), minPlays);
      }
    }

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
          cooldownReleased: false,
          shuttlecocks: { baru: 0, bekas_layak: 0, bekas_dihasilkan: 0 }
        },
        message: 'Jumlah pemain berstatus menunggu kurang dari 4 orang.'
      };
    }

    const four = pickNextFourPlayersForMatch(queue, partnerRequests, partnerHistory, players);
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
      cooldownReleased: !!cooldownReleased,
      partnerDetails: {
        teamAPairHistory: historyA,
        teamBPairHistory: historyB,
        hasRepeatedInTeamA: historyA > 0,
        hasRepeatedInTeamB: historyB > 0
      },
      playerSummaries,
      usedRequest: split.usedRequest || null,
      usedRequests: split.usedRequests || (split.usedRequest ? [split.usedRequest] : []),
      shuttlecocks: { baru: 0, bekas_layak: 0, bekas_dihasilkan: 0 },
      proposedAt: Date.now()
    };

    return { court, message: 'Usulan pertandingan berhasil dibuat dan menunggu persetujuan Host.' };
  }

  /**
   * Host menekan tombol ACC: Pemain resmi menjadi 'di_lapangan' dan court menjadi 'sedang_main'.
   */
  function approveCourtProposal(court, players = [], partnerRequests = []) {
    if (!court || (court.status !== COURT_STATUS.MENUNGGU_ACC && court.status !== 'menunggu_acc' && court.status !== 'pending')) {
      return { success: false, message: 'Status lapangan bukan menunggu ACC.' };
    }

    const matchPlayers = [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean);
    if (matchPlayers.length < 4) {
      return { success: false, message: 'Pemain di lapangan ini kurang dari 4 orang.' };
    }

    // Cek apakah ada pemain yang tidak aktif atau dihapus
    const inactivePlayer = matchPlayers.find(mp => {
      const found = players.find(p => String(p.id) === String(mp.id));
      return !found || found.is_deleted || found.status === PLAYER_STATUS.TIDAK_AKTIF;
    });

    if (inactivePlayer) {
      return {
        success: false,
        message: `Pemain ${inactivePlayer.name || 'terkait'} sudah tidak aktif atau dihapus.`
      };
    }

    // Cek apakah ada pemain yang tidak sengaja sudah di lapangan lain
    const busyPlayer = matchPlayers.find(mp => {
      const found = players.find(p => String(p.id) === String(mp.id));
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
      const found = players.find(p => String(p.id) === String(mp.id));
      if (found) {
        found.status = PLAYER_STATUS.DI_LAPANGAN;
      }
    });

    // Catatan: Request rekan tim TIDAK diselesaikan (COMPLETED) di sini,
    // melainkan saat match resmi selesai dicatat skornya di recordMatchFinished.
    // Jika match ditolak/dikosongkan sebelum selesai, status tetap APPROVED.

    court.status = COURT_STATUS.SEDANG_MAIN;
    court.startedAt = Date.now();
    court.matchId = court.matchId || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));

    return { success: true, court };
  }

  /**
   * Host menolak usulan / mengosongkan lapangan:
   * Pemain kembali ke status 'menunggu', lapangan menjadi 'kosong',
   * dan request rekan tim yang belum selesai dipertahankan berstatus 'approved'.
   */
  function rejectCourtProposal(court, players = [], partnerRequests = []) {
    if (!court) return { success: false };

    const matchPlayers = [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean);
    matchPlayers.forEach(mp => {
      const found = players.find(p => String(p.id) === String(mp.id));
      if (found && found.status !== PLAYER_STATUS.TIDAK_AKTIF && !found.is_deleted) {
        found.status = PLAYER_STATUS.MENUNGGU;
      }
    });

    // Jika ada request rekan tim di court ini, pastikan statusnya tetap/kembali APPROVED
    const reqsToRestore = court.usedRequests || (court.usedRequest ? [court.usedRequest] : []);
    if (Array.isArray(partnerRequests)) {
      reqsToRestore.forEach(ur => {
        const req = partnerRequests.find(r => String(r.id) === String(ur.id));
        if (req && req.status !== REQUEST_STATUS.CANCELLED) {
          req.status = REQUEST_STATUS.APPROVED;
        }
      });
    }

    court.status = COURT_STATUS.KOSONG;
    court.teamA = [];
    court.teamB = [];
    court.scoreA = null;
    court.scoreB = null;
    court.winner = null;
    court.playerSummaries = null;
    court.usedRequest = null;
    court.usedRequests = [];

    return { success: true, court };
  }

  // ── 6b. PENGGANTIAN PEMAIN OTOMATIS DARI ANTRIAN LAPANGAN (PRIORITAS MAIN SEDIKIT & REGULASI GENDER) ──
  /**
   * Menemukan pemain pengganti terbaik dari antrian menunggu jika seorang pemain di lapangan diganti.
   * Diprioritaskan pemain yang mainnya masih sedikit (prioritizeQueue) dan memenuhi regulasi:
   * - Wanita diganti dengan wanita.
   * - Pria diganti dengan pria, terkecuali wanita dengan role Intermediate yang bisa menggantikan pria.
   * - Jika wanita yang diganti memiliki role Intermediate, ia bisa diganti oleh wanita atau pria.
   * - Tidak melanggar aturan role (Intermediate + Advance dilarang 1 tim).
   */
  function findBestCourtReplacementPlayer({
    court,
    targetPlayerId,
    players = [],
    minPlays = 3
  }) {
    if (!court || !targetPlayerId) return null;

    const targetIdStr = String(targetPlayerId);
    let targetTeamKey = null;
    let targetIdx = -1;
    let sourcePlayer = null;
    let teammate = null;

    ['teamA', 'teamB'].forEach(tKey => {
      const team = court[tKey] || [];
      const idx = team.findIndex(p => p && String(p.id) === targetIdStr);
      if (idx !== -1) {
        targetTeamKey = tKey;
        targetIdx = idx;
        sourcePlayer = team[idx];
        teammate = team.find((p, i) => i !== idx && p);
      }
    });

    if (!sourcePlayer) return null;

    const courtPlayerIds = new Set(
      [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean).map(p => String(p.id))
    );

    const isSourceInterFemale = sourcePlayer.gender === 'P' && isIntermediateRole(sourcePlayer);

    // Filter kandidat yang berstatus 'menunggu'
    const eligibleWaiting = players.filter(p => {
      if (!p || p.is_deleted || p.status === PLAYER_STATUS.TIDAK_AKTIF) return false;
      const pIdStr = String(p.id);
      if (courtPlayerIds.has(pIdStr)) return false;
      if (p.status !== PLAYER_STATUS.MENUNGGU) return false;

      // Regulasi Gender:
      // 1. Jika wanita yang diganti adalah Intermediate -> bisa diganti siapa saja (P atau L)
      // 2. Jika wanita lain (Pemula/Advance) -> wajib diganti wanita (P)
      // 3. Jika pria -> wajib diganti pria (L) ATAU wanita dengan role Intermediate
      let genderCompatible = false;
      if (sourcePlayer.gender === 'P') {
        if (isSourceInterFemale) {
          genderCompatible = true;
        } else {
          genderCompatible = (p.gender === 'P');
        }
      } else { // sourcePlayer pria
        genderCompatible = (p.gender === 'L') || (p.gender === 'P' && isIntermediateRole(p));
      }

      if (!genderCompatible) return false;

      // Regulasi Role: Intermediate & Advance tidak boleh 1 tim
      if (teammate && hasInterAndAdvanceTogether([teammate, p])) {
        return false;
      }

      return true;
    });

    if (eligibleWaiting.length === 0) return null;

    // Urutkan kandidat berdasarkan prioritas main paling sedikit
    const sorted = prioritizeQueue(eligibleWaiting, minPlays);
    return {
      replacement: sorted[0],
      sourcePlayer,
      teammate,
      targetTeamKey,
      targetIdx
    };
  }

  const findBestRestReplacementPlayer = findBestCourtReplacementPlayer;

  /**
   * Menjalankan proses penggantian pemain lapangan secara otomatis:
   * - Menemukan pemain pengganti prioritas (main paling sedikit & sesuai regulasi gender/level)
   * - Memasukkan pengganti ke slot lapangan
   * - Status pemain yang diganti kembali ke 'menunggu' (atau 'istirahat' jika setToRest = true)
   * - Membatalkan partner request aktif dari pemain yang diganti
   * - Memperbarui kategori dan playerSummaries court
   */
  function replaceCourtPlayerAuto({
    court,
    targetPlayerId,
    players = [],
    partnerRequests = [],
    minPlays = 3,
    setToRest = false,
    restCooldown = 1
  }) {
    if (!court) {
      return { success: false, message: 'Data lapangan tidak ditemukan.' };
    }

    const targetIdStr = String(targetPlayerId);
    const searchRes = findBestCourtReplacementPlayer({ court, targetPlayerId, players, minPlays });

    if (!searchRes) {
      const inCourt = [...(court.teamA || []), ...(court.teamB || [])].find(p => p && String(p.id) === targetIdStr);
      if (!inCourt) {
        return { success: false, message: 'Pemain tidak ditemukan di lapangan ini.' };
      }
      return {
        success: false,
        message: 'Tidak ada pemain antrian yang memenuhi kriteria regulasi gender/level untuk menggantikan saat ini.'
      };
    }

    const { replacement, sourcePlayer, targetTeamKey, targetIdx } = searchRes;

    // 1. Update court team slot
    court[targetTeamKey][targetIdx] = replacement;

    // 2. Update status pemain yang diganti
    const realSourcePlayer = players.find(p => String(p.id) === targetIdStr) || sourcePlayer;
    if (setToRest) {
      realSourcePlayer.status = PLAYER_STATUS.ISTIRAHAT;
      realSourcePlayer.cooldown_remaining = restCooldown;
    } else {
      realSourcePlayer.status = PLAYER_STATUS.MENUNGGU;
      realSourcePlayer.cooldown_remaining = 0;
      realSourcePlayer.waitingSince = Date.now();
    }

    // 3. Batalkan request pasangan aktif untuk pemain yang diganti jika ada
    cancelRequestsForPlayer(realSourcePlayer.id, players, partnerRequests);

    // 4. Bersihkan usedRequest lapangan jika terkait dengan pemain yang diganti
    if (court.usedRequests && Array.isArray(court.usedRequests)) {
      court.usedRequests = court.usedRequests.filter(r =>
        String(r.requesterId) !== targetIdStr && String(r.targetId) !== targetIdStr
      );
    }
    if (court.usedRequest && (String(court.usedRequest.requesterId) === targetIdStr || String(court.usedRequest.targetId) === targetIdStr)) {
      court.usedRequest = court.usedRequests && court.usedRequests[0] ? court.usedRequests[0] : null;
    }

    // 5. Update status pemain pengganti jika court sudah 'sedang_main'
    const realReplacement = players.find(p => String(p.id) === String(replacement.id)) || replacement;
    if (court.status === COURT_STATUS.SEDANG_MAIN) {
      realReplacement.status = PLAYER_STATUS.DI_LAPANGAN;
    }

    // 6. Perbarui metadata court (category, categoryLabel, playerSummaries)
    const allFour = [...(court.teamA || []), ...(court.teamB || [])].filter(Boolean);
    const hasFemale = allFour.some(p => p.gender === 'P');
    const allFemale = allFour.length === 4 && allFour.every(p => p.gender === 'P');
    court.category = allFemale ? 'PUTRI' : (hasFemale ? 'CAMPURAN' : 'PUTRA');
    court.categoryLabel = allFemale ? 'Putri vs Putri' : (hasFemale ? 'Terbuka / Campuran' : 'Ganda Putra');

    court.playerSummaries = allFour.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      gender: p.gender,
      jumlah_main: p.jumlah_main || 0,
      quotaMet: (p.jumlah_main || 0) >= minPlays
    }));

    return {
      success: true,
      court,
      oldPlayer: realSourcePlayer,
      newPlayer: realReplacement,
      message: setToRest
        ? `${realSourcePlayer.name} memilih istirahat. Digantikan oleh ${realReplacement.name} (main: ${realReplacement.jumlah_main || 0}x).`
        : `${realSourcePlayer.name} berhasil diganti oleh ${realReplacement.name} (main: ${realReplacement.jumlah_main || 0}x).`
    };
  }

  function replaceCourtPlayerWithRest(options) {
    return replaceCourtPlayerAuto({ ...options, setToRest: true });
  }

  // ── 7. FITUR 4: INPUT SKOR LANGSUNG & KLASEMEN REAL-TIME ──
  /**
   * Validasi skor pertandingan bulutangkis.
   */
  function validateBadmintonScore(scoreA, scoreB, winner, options = {}) {
    if (scoreA === null || scoreA === undefined || (typeof scoreA === 'string' && scoreA.trim() === '')) {
      return { valid: false, message: 'Skor Tim A tidak boleh kosong.' };
    }
    if (scoreB === null || scoreB === undefined || (typeof scoreB === 'string' && scoreB.trim() === '')) {
      return { valid: false, message: 'Skor Tim B tidak boleh kosong.' };
    }

    const sA = Number(scoreA);
    const sB = Number(scoreB);

    if (isNaN(sA) || isNaN(sB)) {
      return { valid: false, message: 'Skor harus berupa angka valid.' };
    }
    if (!Number.isInteger(sA) || !Number.isInteger(sB)) {
      return { valid: false, message: 'Skor harus berupa bilangan bulat.' };
    }
    if (sA < 0 || sB < 0) {
      return { valid: false, message: 'Skor tidak boleh negatif.' };
    }

    const maxScore = (typeof options.maxScore === 'number' && options.maxScore > 0) ? options.maxScore : 99;
    if (sA > maxScore || sB > maxScore) {
      return { valid: false, message: `Skor tidak boleh melebihi batas maksimal (${maxScore}).` };
    }

    if (sA === sB) {
      return { valid: false, message: 'Pertandingan bulu tangkis tidak boleh berakhir seri (skor sama).' };
    }

    // Aturan Skor Resmi (BWF Official Rules - Opsional)
    if (options.officialRules) {
      const winScore = Math.max(sA, sB);
      const loseScore = Math.min(sA, sB);

      if (winScore < 21) {
        return { valid: false, message: 'Aturan resmi: Skor pemenang minimal 21 poin.' };
      }
      if (winScore > 30) {
        return { valid: false, message: 'Aturan resmi: Skor maksimal adalah 30 poin.' };
      }
      // Selisih minimal 2 poin, kecuali mencapai skor sudden death 30 (yaitu 30-29)
      if (winScore < 30 && (winScore - loseScore) < 2) {
        return { valid: false, message: 'Aturan resmi: Pemenang harus unggul minimal 2 poin (deuce).' };
      }
    }

    // Dalam bulutangkis, pemenang selalu tim dengan perolehan skor yang lebih tinggi
    const declaredWinner = sA > sB ? 'A' : 'B';

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
    partnerRequests = [],
    shuttlecocks = null,
    defaultCooldown = 1,
    inventory = null,
    options = {}
  }) {
    const validation = validateBadmintonScore(scoreA, scoreB, winner, options);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    const wasAlreadyFinished = court.status === COURT_STATUS.FINISHED;

    court.scoreA = validation.scoreA;
    court.scoreB = validation.scoreB;
    court.winner = validation.winner;
    court.status = COURT_STATUS.FINISHED;
    court.finishedAt = Date.now();
    court.matchId = court.matchId || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));

    if (shuttlecocks) {
      court.shuttlecocks = {
        baru: Math.max(0, Math.floor(Number(shuttlecocks.baru) || 0)),
        bekas_layak: Math.max(0, Math.floor(Number(shuttlecocks.bekas_layak) || 0)),
        bekas_dihasilkan: Math.max(0, Math.floor(Number(shuttlecocks.bekas_dihasilkan) || 0))
      };
      // Q-2: Mutasi langsung ke inventory dihapus. Sumber kebenaran tunggal adalah getShuttlecockSummary(schedule, inventory).
    }

    const teamA = (court.teamA || []).filter(Boolean);
    const teamB = (court.teamB || []).filter(Boolean);
    const allCourtPlayers = [...teamA, ...teamB];

    // Jika ini bukan edit skor dari match yang sudah dihitung sebelumnya:
    if (!wasAlreadyFinished) {
      // 1. Tambah counter jumlah_main pemain
      allCourtPlayers.forEach(cp => {
        const p = players.find(x => String(x.id) === String(cp.id));
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
      processCooldownsOnMatchEnd(players, allCourtPlayers, defaultCooldown, partnerRequests);

      // 5. Tandai request rekan tim sebagai selesai jika digunakan pada match ini
      const reqsToComplete = court.usedRequests || (court.usedRequest ? [court.usedRequest] : []);
      if (Array.isArray(partnerRequests)) {
        reqsToComplete.forEach(ur => {
          const req = partnerRequests.find(r => String(r.id) === String(ur.id));
          if (req) {
            req.status = REQUEST_STATUS.COMPLETED;
            req.completedAt = Date.now();
          }
        });

        // Auto-complete request jika pemain berpasangan di tim A atau tim B
        partnerRequests.forEach(req => {
          if (!req || req.status !== REQUEST_STATUS.APPROVED) return;
          const rReq = String(req.requesterId);
          const rTgt = String(req.targetId);
          const inA = teamA.length >= 2 &&
            ((String(teamA[0].id) === rReq && String(teamA[1].id) === rTgt) ||
             (String(teamA[1].id) === rReq && String(teamA[0].id) === rTgt));
          const inB = teamB.length >= 2 &&
            ((String(teamB[0].id) === rReq && String(teamB[1].id) === rTgt) ||
             (String(teamB[1].id) === rReq && String(teamB[0].id) === rTgt));
          if (inA || inB) {
            req.status = REQUEST_STATUS.COMPLETED;
            req.completedAt = Date.now();
          }
        });
      }
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
    newWinner,
    options = {}
  }) {
    const validation = validateBadmintonScore(newScoreA, newScoreB, newWinner, options);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    court.scoreA = validation.scoreA;
    court.scoreB = validation.scoreB;
    court.winner = validation.winner;
    court.status = COURT_STATUS.FINISHED;

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
      const seenCourts = new Set();
      const allCourts = [];
      [...(round.courts || []), ...(round.finishedCourts || [])].forEach(c => {
        if (!c || c.status !== 'finished') return;
        if (seenCourts.has(c)) return;
        if (c.matchId && Array.from(seenCourts).some(sc => sc.matchId === c.matchId)) return;
        seenCourts.add(c);
        allCourts.push(c);
      });
      allCourts.forEach(c => {
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

    // Default: Regulasi resmi (Wins -> H2H bila tepat 2 seri -> Total Poin -> Gelar/Titles)
    return resolveStandingsByRules(list, getH2H);
  }

  /**
   * Aturan Penentuan Peringkat Hierarkis Resmi (BUG-9 / README):
   * 1. Peringkat utama: Jumlah Kemenangan terbanyak (Wins) / Poin klasemen (Soccer).
   * 2. Jika menang sama:
   *    a. Head-to-Head (H2H jika tepat 2 pemain/tim pernah bertanding langsung).
   *    b. Total Poin yang didapat di seluruh ronde.
   *    c. Rekam Jejak Juara (titles).
   *    d. Undian / Nilai Sama.
   */
  function resolveStandingsByRules(items = [], getH2H) {
    items.forEach(it => { it.tieBreakNote = ''; });

    const groups = {};
    items.forEach(it => {
      const primaryKey = (it.pts !== undefined && it.p !== undefined) ? (it.pts || 0) : (it.wins || 0);
      if (!groups[primaryKey]) groups[primaryKey] = [];
      groups[primaryKey].push(it);
    });

    const sortedKeys = Object.keys(groups).map(Number).sort((a, b) => b - a);
    let result = [];
    sortedKeys.forEach(k => {
      result = result.concat(resolveTiedSubset(groups[k], getH2H));
    });
    return result;
  }

  function resolveTiedSubset(subset, getH2H) {
    if (subset.length <= 1) return subset;

    // 1. Head-to-Head HANYA jika tepat 2 tim/pemain yang seri
    if (subset.length === 2 && typeof getH2H === 'function') {
      const h2h = getH2H(subset[0], subset[1]);
      if (h2h > 0) {
        subset[0].tieBreakNote = `Unggul H2H vs ${subset[1].name}`;
        return [subset[0], subset[1]];
      } else if (h2h < 0) {
        subset[1].tieBreakNote = `Unggul H2H vs ${subset[0].name}`;
        return [subset[1], subset[0]];
      }
    }

    // 2. Total Poin yang Didapat di Seluruh Ronde (totalScore / scored)
    const scoreGroups = {};
    subset.forEach(it => {
      const s = (it.totalScore !== undefined) ? it.totalScore : (it.scored || 0);
      if (!scoreGroups[s]) scoreGroups[s] = [];
      scoreGroups[s].push(it);
    });
    const scoreKeys = Object.keys(scoreGroups).map(Number).sort((a, b) => b - a);

    if (scoreKeys.length > 1) {
      let result = [];
      scoreKeys.forEach(s => {
        const sub = scoreGroups[s];
        if (sub.length === 1) {
          sub[0].tieBreakNote = `Total Poin (${s} Poin)`;
          result.push(sub[0]);
        } else {
          result = result.concat(resolveByTitles(sub, getH2H));
        }
      });
      return result;
    }

    // Jika total poin sama semua:
    return resolveByTitles(subset, getH2H);
  }

  function resolveByTitles(subset, getH2H) {
    if (subset.length <= 1) return subset;

    // Jika setelah filter poin tersisa tepat 2 pemain, cek H2H
    if (subset.length === 2 && typeof getH2H === 'function') {
      const h2h = getH2H(subset[0], subset[1]);
      if (h2h > 0) {
        subset[0].tieBreakNote = `Unggul H2H vs ${subset[1].name}`;
        return [subset[0], subset[1]];
      } else if (h2h < 0) {
        subset[1].tieBreakNote = `Unggul H2H vs ${subset[0].name}`;
        return [subset[1], subset[0]];
      }
    }

    // 3. Rekam Jejak Juara (titles)
    const titleGroups = {};
    subset.forEach(it => {
      const t = it.titles || 0;
      if (!titleGroups[t]) titleGroups[t] = [];
      titleGroups[t].push(it);
    });
    const titleKeys = Object.keys(titleGroups).map(Number).sort((a, b) => b - a);

    if (titleKeys.length > 1) {
      let result = [];
      titleKeys.forEach(t => {
        const sub = titleGroups[t];
        if (sub.length === 1) {
          sub[0].tieBreakNote = `Gelar Juara (${t} kali)`;
          result.push(sub[0]);
        } else {
          result = result.concat(sub);
        }
      });
      return result;
    }

    // 4. Undian / Nilai Sama
    subset[0].tieBreakNote = subset[0].tieBreakNote || 'Undian / Nilai Sama';
    return subset;
  }

  // ── 8. FITUR 3: PENANGANAN TAMBAH & SOFT DELETE PEMAIN ──
  /**
   * Menambahkan pemain baru di tengah sesi tanpa mereset data.
   */
  function addPlayerIncremental(players = [], newPlayerData = {}) {
    let rawName = typeof newPlayerData.name === 'string' ? newPlayerData.name : '';
    // Q-7: Trim spasi berurutan dan batasi panjang nama maksimal 40 karakter
    const cleanName = rawName.replace(/\s+/g, ' ').trim().slice(0, 40);

    // Q-7: Cek apakah nama sudah ada (case-insensitive), beri peringatan (bukan blokir)
    const normalizedNew = cleanName.toLowerCase();
    const isDuplicate = Boolean(cleanName) && players.some(p => p && !p.is_deleted && p.name && p.name.trim().toLowerCase() === normalizedNew);
    const warning = isDuplicate ? `Nama "${cleanName}" sudah terdaftar sebelumnya.` : null;

    const newPlayer = {
      id: newPlayerData.id || (Date.now() + Math.floor(Math.random() * 1000)),
      name: cleanName,
      gender: newPlayerData.gender || 'L',
      role: newPlayerData.role || 'Intermadiate',
      paid: true,
      status: PLAYER_STATUS.MENUNGGU,
      jumlah_main: 0,
      titles: typeof newPlayerData.titles === 'number' && newPlayerData.titles >= 0 ? Math.floor(newPlayerData.titles) : 0,
      request_used: false,
      cooldown_remaining: 0,
      leave_after_match: false,
      is_deleted: false,
      waitingSince: typeof newPlayerData.waitingSince === 'number' ? newPlayerData.waitingSince : Date.now(),
      createdAt: Date.now()
    };

    if (warning) {
      newPlayer.warning = warning;
      newPlayer.isDuplicate = true;
    }

    players.push(newPlayer);
    return newPlayer;
  }

  /**
   * Mengurangi pemain di tengah sesi tanpa menghapus histori skor/klasemen.
   */
  function removePlayerIncremental(playerId, players = [], activeCourts = [], partnerRequests = []) {
    const pIdStr = String(playerId);
    const player = players.find(p => String(p.id) === pIdStr);
    if (!player) return { success: false, message: 'Pemain tidak ditemukan.' };

    // Cek apakah pemain sedang bermain di pertandingan aktif (sedang main / ongoing)
    const isCurrentlyPlaying = activeCourts.some(c => {
      if (!c) return false;
      const isLiveMatch = c.status === COURT_STATUS.SEDANG_MAIN || c.status === 'sedang_main' || c.status === 'ongoing';
      if (!isLiveMatch) return false;
      const courtPlayers = [...(c.teamA || []), ...(c.teamB || [])].filter(Boolean);
      return courtPlayers.some(p => String(p.id) === pIdStr);
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

    // Jika pemain ada di lapangan yang masih berstatus proposal (menunggu_acc), batalkan proposal lapangan tersebut
    activeCourts.forEach(c => {
      if (!c || (c.status !== COURT_STATUS.MENUNGGU_ACC && c.status !== 'menunggu_acc')) return;
      const courtPlayers = [...(c.teamA || []), ...(c.teamB || [])].filter(Boolean);
      if (courtPlayers.some(p => String(p.id) === pIdStr)) {
        rejectCourtProposal(c, players, partnerRequests);
      }
    });

    // Jika sedang menunggu atau istirahat, segera nonaktifkan
    player.status = PLAYER_STATUS.TIDAK_AKTIF;
    player.is_deleted = true;
    player.cooldown_remaining = 0;
    cancelRequestsForPlayer(playerId, players, partnerRequests);

    return {
      success: true,
      mode: 'immediate_inactive',
      message: `${player.name} telah dikeluarkan dari antrian (status: Tidak Aktif). Histori skor dan klasemen tetap tersimpan.`
    };
  }

  // ── 9. FITUR 6: MONITORING & MANAJEMEN KOK ──
  function createDefaultShuttlecockInventory(stokAwalBaru = 24, stokAwalBekas = 12) {
    return {
      stokAwalBaru: Math.max(0, Math.floor(Number(stokAwalBaru) || 0)),
      stokAwalBekas: Math.max(0, Math.floor(Number(stokAwalBekas) || 0))
    };
  }

  function getShuttlecockSummary(schedule = [], inventory = null) {
    let terpakaiBaru = 0;
    let terpakaiBekas = 0;
    let bekasLayakDidapat = 0;
    const perCourtUsage = {};

    schedule.forEach(round => {
      if (!round) return;
      const seenCourts = new Set();
      const allCourts = [];
      [...(round.courts || []), ...(round.finishedCourts || [])].forEach(c => {
        if (!c) return;
        if (seenCourts.has(c)) return;
        if (c.matchId && Array.from(seenCourts).some(sc => sc.matchId === c.matchId)) return;
        seenCourts.add(c);
        allCourts.push(c);
      });
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
    const sisaBaru = Math.max(0, (Number(inv.stokAwalBaru) || 0) - terpakaiBaru);
    const sisaBekas = Math.max(0, (Number(inv.stokAwalBekas) || 0) - terpakaiBekas + bekasLayakDidapat);

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

  // ── RESET SESI MABAR (BUG-4) ──
  function resetBadmintonSession({
    players = [],
    inventory = null,
    clearInactive = false
  } = {}) {
    let updatedPlayers = players;
    if (clearInactive) {
      updatedPlayers = updatedPlayers.filter(p => !p.is_deleted && p.status !== PLAYER_STATUS.TIDAK_AKTIF);
    }

    updatedPlayers.forEach(p => {
      p.jumlah_main = 0;
      p.cooldown_remaining = 0;
      p.request_used = false;
      p.leave_after_match = false;
      if (!p.is_deleted && p.status !== PLAYER_STATUS.TIDAK_AKTIF) {
        p.status = PLAYER_STATUS.MENUNGGU;
        p.waitingSince = Date.now();
      }
    });

    let resetInventory = null;
    if (inventory) {
      resetInventory = {
        stokAwalBaru: Math.max(0, Math.floor(Number(inventory.stokAwalBaru) || 24)),
        stokAwalBekas: Math.max(0, Math.floor(Number(inventory.stokAwalBekas) || 12))
      };
      if ('terpakaiBaru' in inventory) resetInventory.terpakaiBaru = 0;
      if ('terpakaiBekas' in inventory) resetInventory.terpakaiBekas = 0;
      if ('bekasLayakDidapat' in inventory) resetInventory.bekasLayakDidapat = 0;
    }

    return {
      players: updatedPlayers,
      partnerHistory: {},
      opponentHistory: {},
      partnerRequests: [],
      auditLog: [],
      schedule: [],
      currentRoundIndex: 0,
      inventory: resetInventory
    };
  }

  // ── PEER HEARTBEAT COUNTER (BUG-7) ──
  function calculateActivePeers(heartbeats = {}, maxAgeMs = 40000, now = Date.now()) {
    let count = 0;
    const entries = heartbeats instanceof Map ? heartbeats.entries() : Object.entries(heartbeats || {});
    for (const [, lastSeen] of entries) {
      if (now - Number(lastSeen) <= maxAgeMs) {
        count++;
      }
    }
    return count + 1; // +1 untuk perangkat lokal sendiri
  }

  // ── 11. XSS SANITIZATION HELPER ──
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  // ── 12. STATE VALIDATION & NORMALIZATION (SEC-1 / Q-6) ──
  function validateAndNormalizeState(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const clean = {
      version: typeof data.version === 'number' ? data.version : 3,
      currentSport: data.currentSport === 'minisoccer' ? 'minisoccer' : 'badminton',
      sessionTitle: typeof data.sessionTitle === 'string' ? data.sessionTitle.trim().slice(0, 80) : 'Mabar',
      plannedRounds: Number.isInteger(data.plannedRounds) && data.plannedRounds > 0 ? Math.min(data.plannedRounds, 100) : 8,
      
      bPlayers: [],
      bSchedule: [],
      bCurrentRoundIndex: Number.isInteger(data.bCurrentRoundIndex) && data.bCurrentRoundIndex >= 0 ? data.bCurrentRoundIndex : 0,
      bNumCourts: Number.isInteger(data.bNumCourts) && data.bNumCourts > 0 ? Math.min(data.bNumCourts, 20) : 2,
      bMinPlays: Number.isInteger(data.bMinPlays) && data.bMinPlays >= 0 ? Math.min(data.bMinPlays, 20) : 3,
      bCooldownMatches: Number.isInteger(data.bCooldownMatches) && data.bCooldownMatches >= 0 ? Math.min(data.bCooldownMatches, 10) : 1,
      bPartnerRequests: [],
      bPartnerHistory: {},
      bOpponentHistory: {},
      bShuttlecockInventory: {
        stokAwalBaru: 24,
        stokAwalBekas: 12,
        terpakaiBaru: 0,
        terpakaiBekas: 0,
        bekasLayakDidapat: 0
      },
      bAuditLog: [],

      sPlayers: [],
      sTeamCount: Number.isInteger(data.sTeamCount) && data.sTeamCount >= 2 ? Math.min(data.sTeamCount, 10) : 2,
      sTeams: [],
      sMatches: [],
      sCurrentMatchIndex: Number.isInteger(data.sCurrentMatchIndex) && data.sCurrentMatchIndex >= 0 ? data.sCurrentMatchIndex : 0
    };

    clean.rev = Number.isInteger(data.rev) && data.rev >= 0 ? data.rev : 0;
    clean.bSessionId = typeof data.bSessionId === 'string' ? data.bSessionId.slice(0, 100) : ('sess_' + Date.now());
    clean.bAwardedSessionIds = Array.isArray(data.bAwardedSessionIds)
      ? data.bAwardedSessionIds.filter(id => typeof id === 'string').slice(0, 100)
      : [];
    clean.bOfficialScoring = Boolean(data.bOfficialScoring);

    if (Array.isArray(data.bPlayers)) {
      if (data.bPlayers.length > 200) return null;
      const seenIds = new Set();
      for (const p of data.bPlayers) {
        if (!p || typeof p !== 'object') return null;
        if (p.id === undefined || p.id === null) return null;
        const pid = String(p.id);
        if (seenIds.has(pid)) return null;
        seenIds.add(pid);
        clean.bPlayers.push({
          id: typeof p.id === 'number' ? p.id : pid,
          name: typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '',
          gender: p.gender === 'P' ? 'P' : 'L',
          role: typeof p.role === 'string' ? p.role.slice(0, 20) : 'Intermadiate',
          paid: Boolean(p.paid !== false),
          status: Object.values(PLAYER_STATUS).includes(p.status) ? p.status : PLAYER_STATUS.MENUNGGU,
          jumlah_main: typeof p.jumlah_main === 'number' && p.jumlah_main >= 0 ? Math.floor(p.jumlah_main) : 0,
          request_used: Boolean(p.request_used),
          cooldown_remaining: typeof p.cooldown_remaining === 'number' && p.cooldown_remaining >= 0 ? Math.floor(p.cooldown_remaining) : 0,
          leave_after_match: Boolean(p.leave_after_match),
          is_deleted: Boolean(p.is_deleted),
          titles: typeof p.titles === 'number' && p.titles >= 0 ? Math.floor(p.titles) : 0,
          waitingSince: typeof p.waitingSince === 'number' && p.waitingSince >= 0 ? Math.floor(p.waitingSince) : 0,
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now()
        });
      }
    }

    if (Array.isArray(data.bSchedule)) {
      if (data.bSchedule.length > 200) return null;
      let totalMatches = 0;
      for (const r of data.bSchedule) {
        if (!r || typeof r !== 'object') return null;
        const numCourts = Array.isArray(r.courts) ? r.courts.length : 0;
        const numFinished = Array.isArray(r.finishedCourts) ? r.finishedCourts.length : 0;
        totalMatches += (numCourts + numFinished);
        if (totalMatches > 2000) return null;
        clean.bSchedule.push(r);
      }
    }

    if (Array.isArray(data.bPartnerRequests)) {
      if (data.bPartnerRequests.length > 500) return null;
      clean.bPartnerRequests = data.bPartnerRequests.slice(0, 500);
    }

    if (data.bPartnerHistory && typeof data.bPartnerHistory === 'object' && !Array.isArray(data.bPartnerHistory)) {
      clean.bPartnerHistory = { ...data.bPartnerHistory };
    }
    if (data.bOpponentHistory && typeof data.bOpponentHistory === 'object' && !Array.isArray(data.bOpponentHistory)) {
      clean.bOpponentHistory = { ...data.bOpponentHistory };
    }

    if (data.bShuttlecockInventory && typeof data.bShuttlecockInventory === 'object') {
      const inv = data.bShuttlecockInventory;
      clean.bShuttlecockInventory = {
        stokAwalBaru: typeof inv.stokAwalBaru === 'number' && inv.stokAwalBaru >= 0 ? Math.floor(inv.stokAwalBaru) : 24,
        stokAwalBekas: typeof inv.stokAwalBekas === 'number' && inv.stokAwalBekas >= 0 ? Math.floor(inv.stokAwalBekas) : 12
      };
      // Q-2: Baca-tolerir counter lama jika ada di data lama (backward compatibility)
      if (typeof inv.terpakaiBaru === 'number') {
        clean.bShuttlecockInventory.terpakaiBaru = Math.max(0, Math.floor(inv.terpakaiBaru));
      }
      if (typeof inv.terpakaiBekas === 'number') {
        clean.bShuttlecockInventory.terpakaiBekas = Math.max(0, Math.floor(inv.terpakaiBekas));
      }
      if (typeof inv.bekasLayakDidapat === 'number') {
        clean.bShuttlecockInventory.bekasLayakDidapat = Math.max(0, Math.floor(inv.bekasLayakDidapat));
      }
    }

    if (Array.isArray(data.bAuditLog)) {
      clean.bAuditLog = data.bAuditLog.slice(0, 500);
    }

    if (Array.isArray(data.sPlayers)) {
      if (data.sPlayers.length > 200) return null;
      clean.sPlayers = data.sPlayers.map(p => ({
        id: p.id,
        name: typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '',
        gender: p.gender === 'P' ? 'P' : 'L',
        role: typeof p.role === 'string' ? p.role.slice(0, 10) : 'MF'
      }));
    }
    if (Array.isArray(data.sTeams)) clean.sTeams = data.sTeams;
    if (Array.isArray(data.sMatches)) {
      if (data.sMatches.length > 2000) return null;
      clean.sMatches = data.sMatches;
    }

    return clean;
  }

  // ── SEC-2 & SEC-3 MQTT AUTH & HARDENING ──
  function getSubtleCrypto() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) return nodeCrypto.webcrypto.subtle;
      } catch (e) {}
    }
    return null;
  }

  function getRandomValues(array) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) return crypto.getRandomValues(array);
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        if (nodeCrypto.randomFillSync) return nodeCrypto.randomFillSync(array);
      } catch (e) {}
    }
    for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
    return array;
  }

  function generateNonce(byteLen = 16) {
    const bytes = new Uint8Array(byteLen);
    getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveHmacKey(pin, roomId) {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    const enc = new TextEncoder();
    const pinStr = String(pin || '').trim();
    const roomStr = String(roomId || '').trim().toUpperCase();
    const keyMaterial = await subtle.importKey(
      'raw',
      enc.encode(pinStr),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('ONESPORT_SALT_' + roomStr),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify']
    );
  }

  async function generateEcdsaKeyPair() {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    return subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
  }

  async function exportEcdsaPublicKey(publicKey) {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    const raw = await subtle.exportKey('raw', publicKey);
    return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function buildCanonicalPayload(msg) {
    const contentStr = typeof msg.payload === 'object' && msg.payload !== null
      ? JSON.stringify(msg.payload)
      : String(msg.payload || '');
    return `${msg.type}|${msg.roomId}|${msg.seq}|${msg.ts}|${contentStr}`;
  }

  async function signMessage(msg, options = {}) {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    const enc = new TextEncoder();
    const out = { ...msg };
    out.seq = typeof options.seq === 'number' ? options.seq : 1;
    out.ts = typeof options.ts === 'number' ? options.ts : Date.now();
    const canonical = buildCanonicalPayload(out);
    const dataBytes = enc.encode(canonical);

    if (options.hmacKey) {
      const sigBuf = await subtle.sign('HMAC', options.hmacKey, dataBytes);
      out.sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (options.ecdsaPrivateKey) {
      const pubSigBuf = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, options.ecdsaPrivateKey, dataBytes);
      out.hostPubSig = Array.from(new Uint8Array(pubSigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      out.hostSigPublic = options.hostPubHex;
    }
    return out;
  }

  async function verifyMessage(msg, options = {}) {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    if (!msg || typeof msg !== 'object') {
      return { valid: false, reason: 'Invalid message structure' };
    }
    if (typeof msg.seq !== 'number' || typeof msg.ts !== 'number') {
      return { valid: false, reason: 'Missing sequence or timestamp' };
    }
    if (typeof options.lastSeenSeq === 'number' && msg.seq <= options.lastSeenSeq) {
      return { valid: false, reason: 'Replay detected: seq <= lastSeenSeq' };
    }

    const enc = new TextEncoder();
    const canonical = buildCanonicalPayload(msg);
    const dataBytes = enc.encode(canonical);

    // If receiver has HMAC key (Host / Referee with PIN):
    if (options.hmacKey) {
      if (!msg.sig || typeof msg.sig !== 'string' || msg.sig.length !== 64) {
        return { valid: false, reason: 'Missing or malformed HMAC signature' };
      }
      try {
        const sigBytes = new Uint8Array(msg.sig.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const valid = await subtle.verify('HMAC', options.hmacKey, sigBytes, dataBytes);
        if (!valid) {
          return { valid: false, reason: 'HMAC signature verification failed' };
        }
        return { valid: true };
      } catch (e) {
        return { valid: false, reason: 'HMAC verification error: ' + e.message };
      }
    }

    // If spectator (verifying ECDSA via TOFU)
    if (options.isSpectator) {
      if (!msg.hostSigPublic || !msg.hostPubSig) {
        return { valid: false, reason: 'Missing host public key or signature' };
      }
      if (options.trustedHostPub && msg.hostSigPublic !== options.trustedHostPub) {
        return { valid: false, reason: 'Host public key mismatch (possible imposter)' };
      }
      try {
        const pubBytes = new Uint8Array(msg.hostSigPublic.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const sigBytes = new Uint8Array(msg.hostPubSig.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const importedPub = await subtle.importKey(
          'raw',
          pubBytes,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify']
        );
        const valid = await subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          importedPub,
          sigBytes,
          dataBytes
        );
        if (!valid) {
          return { valid: false, reason: 'ECDSA signature verification failed' };
        }
        return { valid: true, newHostPub: msg.hostSigPublic };
      } catch (err) {
        return { valid: false, reason: 'ECDSA error: ' + err.message };
      }
    }

    return { valid: false, reason: 'No verification key provided' };
  }

  function createPinChallenge(candidateSenderId, reqNonce) {
    return {
      candidateSenderId,
      reqNonce,
      challengeNonce: generateNonce(16),
      expires: Date.now() + 30000
    };
  }

  async function solvePinChallenge(challengeNonce, pin) {
    const subtle = getSubtleCrypto();
    if (!subtle) throw new Error('WebCrypto subtle is not available in this environment');
    const enc = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      'raw',
      enc.encode(String(pin || '').trim()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await subtle.sign('HMAC', keyMaterial, enc.encode(challengeNonce));
    return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPinResponse(challengeNonce, hostPin, authResponseHex) {
    if (!authResponseHex || typeof authResponseHex !== 'string') return false;
    const expected = await solvePinChallenge(challengeNonce, hostPin);
    return expected.toLowerCase() === authResponseHex.toLowerCase();
  }

  const MqttAuth = {
    generateNonce,
    deriveHmacKey,
    generateEcdsaKeyPair,
    exportEcdsaPublicKey,
    signMessage,
    verifyMessage,
    createPinChallenge,
    solvePinChallenge,
    verifyPinResponse
  };

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
    findBestCourtReplacementPlayer,
    findBestRestReplacementPlayer,
    replaceCourtPlayerAuto,
    replaceCourtPlayerWithRest,
    validateBadmintonScore,
    recordMatchFinished,
    editFinishedMatchScore,
    calculateStandings,
    resolveStandingsByRules,
    addPlayerIncremental,
    removePlayerIncremental,
    createDefaultShuttlecockInventory,
    getShuttlecockSummary,
    resetBadmintonSession,
    calculateActivePeers,
    logHostAction,
    escapeHtml,
    validateAndNormalizeState,
    MqttAuth
  };
});
