'use strict';

const path = require('path');
const express = require('express');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('404', { message: 'Admin access required.' });
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// Admin settings page
router.get('/', requireLogin, requireAdmin, (req, res) => {
  const db = req.app.locals.db || require(path.join(__dirname, '..', '..', '..', '..', 'db', 'connection'));
  const settings = db.prepare('SELECT * FROM viber_bot_settings WHERE id = 1').get() || {};
  res.render(path.join(__dirname, '..', 'views', 'viber-bot', 'settings'), {
    settings,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
});

// Save settings
router.post('/settings', requireLogin, requireAdmin, async (req, res) => {
  const db = req.app.locals.db || require(path.join(__dirname, '..', '..', '..', '..', 'db', 'connection'));
  const { auth_token, admin_id, public_url, enabled } = req.body;

  const current = db.prepare('SELECT * FROM viber_bot_settings WHERE id = 1').get();
  const isMasked = (val) => val && val.includes('****');
  const tokenVal = isMasked(auth_token) ? current.auth_token : (auth_token || null);

  db.prepare(`
    UPDATE viber_bot_settings SET
      auth_token = ?, admin_id = ?, public_url = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(tokenVal, admin_id || null, public_url || null, enabled ? 1 : 0);

  // Register webhook if public_url set
  if (enabled && public_url) {
    try {
      const bot = req.app.locals.viberBot;
      if (bot) await bot.registerWebhook(public_url);
    } catch (err) {
      console.error('[viber-bot] Webhook registration failed:', err.message);
    }
  }

  req.flash('success', 'Viber settings saved.');
  res.redirect('/viber-bot');
});

// Test connection
router.post('/test', requireLogin, requireAdmin, async (req, res) => {
  try {
    const bot = req.app.locals.viberBot;
    if (!bot) {
      return res.json({ success: false, error: 'Viber addon not loaded.' });
    }
    await bot.test();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
