/**
 * ============================================================================
 * VERCEL SERVERLESS API: /api/players
 * Endpoint REST untuk CRUD pemain ke Database Vercel
 * ============================================================================
 */
const { getPlayers, savePlayer, deletePlayer, getProvider } = require('./db.js');

module.exports = async function handler(req, res) {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query || {};
  const body = req.body || {};
  const roomId = query.roomId || body.roomId || 'DEFAULT';

  try {
    // 1. GET: Ambil daftar pemain
    if (req.method === 'GET') {
      const result = await getPlayers(roomId);
      return res.status(200).json({
        success: true,
        roomId,
        provider: result.provider,
        players: result.players || []
      });
    }

    // 2. POST: Tambah atau update pemain
    if (req.method === 'POST') {
      const player = body.player ? body.player : body;
      if (!player || !player.name) {
        return res.status(400).json({ success: false, message: 'Data pemain tidak valid (nama wajib diisi)' });
      }

      const saveRes = await savePlayer(roomId, player);
      return res.status(200).json({
        success: true,
        roomId,
        provider: saveRes.provider,
        player
      });
    }

    // 3. DELETE: Hapus pemain
    if (req.method === 'DELETE') {
      const playerId = query.id || body.id;
      if (!playerId) {
        return res.status(400).json({ success: false, message: 'ID pemain wajib disertakan' });
      }

      const delRes = await deletePlayer(roomId, playerId);
      return res.status(200).json({
        success: true,
        roomId,
        provider: delRes.provider,
        deletedId: playerId
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    console.error('Error di /api/players:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
