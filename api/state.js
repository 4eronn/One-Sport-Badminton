/**
 * ============================================================================
 * VERCEL SERVERLESS API: /api/state
 * Endpoint REST untuk sinkronisasi state penuh ke Database Vercel
 * ============================================================================
 */
const { getState, saveState, getProvider } = require('./db.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query || {};
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const roomId = query.roomId || body.roomId || 'DEFAULT';

  try {
    // 1. GET: Ambil state terbaru dari Database Vercel
    if (req.method === 'GET') {
      const result = await getState(roomId);
      return res.status(200).json({
        success: true,
        roomId,
        provider: result.provider,
        data: result.data || null
      });
    }

    // 2. POST: Simpan state ke Database Vercel
    if (req.method === 'POST') {
      const statePayload = body.payload ? body.payload : body;
      if (!statePayload || typeof statePayload !== 'object') {
        return res.status(400).json({ success: false, message: 'Payload state tidak valid' });
      }

      const saveRes = await saveState(roomId, statePayload);
      return res.status(200).json({
        success: true,
        roomId,
        provider: saveRes.provider,
        updatedAt: Date.now()
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    console.error('Error di /api/state:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
