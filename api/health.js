/**
 * ============================================================================
 * VERCEL SERVERLESS API: /api/health
 * Endpoint pemeriksaan kesehatan dan status database Vercel
 * ============================================================================
 */
const { checkHealth, getProvider } = require('./db.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const health = await checkHealth();
    return res.status(200).json({
      status: 'ok',
      provider: health.provider || getProvider(),
      connected: health.connected !== false,
      details: health,
      timestamp: Date.now()
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};
