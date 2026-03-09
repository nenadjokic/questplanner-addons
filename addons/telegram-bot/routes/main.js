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
  const settings = db.prepare('SELECT * FROM telegram_bot_settings WHERE id = 1').get() || {};
  res.render(path.join(__dirname, '..', 'views', 'telegram-bot', 'settings'), {
    settings,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
});

// Save settings
router.post('/settings', requireLogin, requireAdmin, (req, res) => {
  const db = req.app.locals.db || require(path.join(__dirname, '..', '..', '..', '..', 'db', 'connection'));
  const { bot_token, chat_id, public_url, enabled } = req.body;

  const current = db.prepare('SELECT * FROM telegram_bot_settings WHERE id = 1').get();
  const isMasked = (val) => val && val.includes('****');
  const tokenVal = isMasked(bot_token) ? current.bot_token : (bot_token || null);

  db.prepare(`
    UPDATE telegram_bot_settings SET
      bot_token = ?, chat_id = ?, public_url = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(tokenVal, chat_id || null, public_url || null, enabled ? 1 : 0);

  req.flash('success', 'Telegram settings saved.');
  res.redirect('/telegram-bot');
});

// Test connection
router.post('/test', requireLogin, requireAdmin, async (req, res) => {
  try {
    const bot = req.app.locals.telegramBot;
    if (!bot) {
      return res.json({ success: false, error: 'Telegram addon not loaded.' });
    }
    await bot.test();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
