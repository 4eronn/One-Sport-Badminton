/**
 * ============================================================================
 * VERCEL SERVERLESS API: /api/auth
 * Endpoint REST untuk autentikasi & sinkronisasi akun (Admin & User)
 * Mendukung login, pendaftaran akun baru, dan update password lintas perangkat
 * ============================================================================
 */
const { getUser, saveUser, authenticateUser, getUsers, getProvider } = require('./db.js');

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

  const action = (query.action || body.action || (req.method === 'POST' ? 'login' : 'check')).toLowerCase();

  try {
    // 1. GET: Cek status auth / daftar user
    if (req.method === 'GET') {
      if (action === 'get') {
        const username = query.username || body.username;
        if (!username) return res.status(400).json({ success: false, message: 'Username wajib diisi' });
        const user = await getUser(username);
        if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        return res.status(200).json({
          success: true,
          user: {
            username: user.username,
            email: user.email,
            name: user.name,
            role: user.role
          },
          provider: user.provider
        });
      }

      const usersRes = await getUsers();
      return res.status(200).json({
        success: true,
        provider: usersRes.provider,
        users: usersRes.users
      });
    }

    // 2. POST: Login, Update, atau SignUp
    if (req.method === 'POST') {
      const username = String(body.username || query.username || '').trim();
      const password = String(body.password || '').trim();

      // ACTION A: LOGIN
      if (action === 'login') {
        if (!username || !password) {
          return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
        }
        const authRes = await authenticateUser(username, password);
        if (authRes.success) {
          return res.status(200).json({
            success: true,
            user: authRes.user,
            provider: authRes.provider
          });
        }
        return res.status(401).json({
          success: false,
          message: authRes.message || 'Akses ditolak: Username atau password salah!'
        });
      }

      // ACTION B: UPDATE USER (Ubah nama, password, atau profil)
      if (action === 'update') {
        if (!username) {
          return res.status(400).json({ success: false, message: 'Username wajib diisi.' });
        }
        const existing = await getUser(username);
        if (!existing) {
          return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
        }

        const newName = body.name !== undefined ? String(body.name).trim() : existing.name;
        const newPassword = body.password ? String(body.password).trim() : existing.password;
        const newEmail = body.email !== undefined ? String(body.email).trim() : existing.email;

        if (newPassword && newPassword.length < 3) {
          return res.status(400).json({ success: false, message: 'Password minimal 3 karakter.' });
        }

        const updateRes = await saveUser({
          username: existing.username,
          name: newName || existing.name,
          password: newPassword,
          email: newEmail,
          role: existing.role
        });

        return res.status(200).json({
          success: true,
          message: 'Akun berhasil diperbarui.',
          user: updateRes.user,
          provider: updateRes.provider
        });
      }

      // ACTION C: SIGNUP USER BARU
      if (action === 'signup') {
        const name = String(body.name || '').trim();
        if (!name || !username || !password) {
          return res.status(400).json({ success: false, message: 'Semua kolom pendaftaran wajib diisi.' });
        }
        if (password.length < 4) {
          return res.status(400).json({ success: false, message: 'Password minimal 4 karakter.' });
        }

        const existing = await getUser(username);
        if (existing) {
          return res.status(409).json({ success: false, message: 'Username sudah digunakan.' });
        }

        const createRes = await saveUser({
          username,
          name,
          password,
          role: 'user'
        });

        return res.status(201).json({
          success: true,
          message: 'Pendaftaran berhasil.',
          user: createRes.user,
          provider: createRes.provider
        });
      }

      return res.status(400).json({ success: false, message: 'Action tidak dikenal' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    console.error('Error di /api/auth:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
