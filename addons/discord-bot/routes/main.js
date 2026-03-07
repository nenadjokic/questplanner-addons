'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

// Resolve db/connection.js from app root (works for both addons/ and data/addons/)
const db = require(path.join(process.cwd(), 'db', 'connection'));

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.redirect('/login');
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// ─── Player: Link Account Page ─────────────────────────────
router.get('/link', requireLogin, (req, res) => {
  const link = db.prepare('SELECT * FROM discord_linked_accounts WHERE user_id = ?').get(req.user.id);
  const viewPath = path.join(__dirname, '..', 'views', 'discord-bot', 'link');
  res.render(viewPath, {
    pageTitle: 'Discord Link',
    settings: { views: req.app.get('views') },
    link,
    username: req.user.username
  });
});

// ─── Admin Settings Page ───────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  const settings = db.prepare('SELECT * FROM discord_bot_settings WHERE id = 1').get();
  const linkedCount = db.prepare('SELECT COUNT(*) as c FROM discord_linked_accounts WHERE verified_at IS NOT NULL').get().c;
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'admin'").get().c;

  const bot = req.app.locals.discordBot;
  const botStatus = bot ? bot.getStatus() : 'stopped';
  const botUsername = bot && bot.client && bot.ready ? bot.client.user.tag : null;

  const viewPath = path.join(__dirname, '..', 'views', 'discord-bot', 'settings');
  res.render(viewPath, {
    pageTitle: 'Discord Bot',
    settings: { ...settings, views: req.app.get('views') },
    linkedCount,
    totalUsers,
    botStatus,
    botUsername
  });
});

// ─── Save Settings ─────────────────────────────────────────
router.post('/settings', requireAdmin, async (req, res) => {
  const { bot_token, guild_id, notification_channel_id, dice_channel_id,
          enable_slash_commands, enable_emoji_rsvp, enable_dice_feed, enable_live_notifications } = req.body;

  db.prepare(`
    UPDATE discord_bot_settings SET
      bot_token = ?,
      guild_id = ?,
      notification_channel_id = ?,
      dice_channel_id = ?,
      enable_slash_commands = ?,
      enable_emoji_rsvp = ?,
      enable_dice_feed = ?,
      enable_live_notifications = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    bot_token || null,
    guild_id || null,
    notification_channel_id || null,
    dice_channel_id || null,
    enable_slash_commands ? 1 : 0,
    enable_emoji_rsvp ? 1 : 0,
    enable_dice_feed ? 1 : 0,
    enable_live_notifications ? 1 : 0
  );

  // Restart bot with new settings
  const bot = req.app.locals.discordBot;
  if (bot) {
    try {
      const started = await bot.restart();
      if (started) {
        return res.json({ success: true, message: 'Settings saved. Bot restarted.' });
      } else {
        return res.json({ success: true, message: 'Settings saved. Bot not started (check token & guild ID).' });
      }
    } catch (err) {
      return res.json({ success: false, message: `Settings saved but bot error: ${err.message}` });
    }
  }

  res.json({ success: true, message: 'Settings saved.' });
});

// ─── Bot Control ───────────────────────────────────────────
router.post('/start', requireAdmin, async (req, res) => {
  const bot = req.app.locals.discordBot;
  if (!bot) return res.json({ success: false, message: 'Bot not initialized.' });
  const started = await bot.start();
  res.json({ success: started, status: bot.getStatus() });
});

router.post('/stop', requireAdmin, async (req, res) => {
  const bot = req.app.locals.discordBot;
  if (!bot) return res.json({ success: false, message: 'Bot not initialized.' });
  await bot.stop();
  res.json({ success: true, status: 'stopped' });
});

router.get('/status', requireAdmin, (req, res) => {
  const bot = req.app.locals.discordBot;
  const status = bot ? bot.getStatus() : 'stopped';
  const username = bot && bot.client && bot.ready ? bot.client.user.tag : null;
  res.json({ status, username });
});

// ─── Test Notification ─────────────────────────────────────
router.post('/test', requireAdmin, async (req, res) => {
  const bot = req.app.locals.discordBot;
  if (!bot || !bot.ready) {
    return res.json({ success: false, message: 'Bot is not connected.' });
  }

  try {
    await bot.sendNotification('session_created', {
      title: 'Test Session',
      description: 'This is a test notification from Quest Planner!',
      sessionId: 0,
      slots: []
    });
    res.json({ success: true, message: 'Test notification sent!' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ─── Linked Accounts ───────────────────────────────────────
router.get('/linked-accounts', requireAdmin, (req, res) => {

  const accounts = db.prepare(`
    SELECT dla.*, u.username
    FROM discord_linked_accounts dla
    JOIN users u ON u.id = dla.user_id
    ORDER BY dla.verified_at DESC NULLS LAST
  `).all();
  res.json(accounts);
});

router.delete('/linked-accounts/:id', requireAdmin, (req, res) => {

  db.prepare('DELETE FROM discord_linked_accounts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Player: Verify Link Code ──────────────────────────────
router.post('/verify', requireLogin, (req, res) => {

  const { code } = req.body;

  if (!code || code.length < 4) {
    return res.json({ success: false, message: 'Invalid verification code.' });
  }

  const link = db.prepare('SELECT * FROM discord_linked_accounts WHERE user_id = ? AND verification_code = ?').get(req.user.id, code.toUpperCase());

  if (!link) {
    return res.json({ success: false, message: 'Invalid code. Use /quest link <username> in Discord first.' });
  }

  if (link.verified_at) {
    return res.json({ success: false, message: 'Account already verified.' });
  }

  db.prepare("UPDATE discord_linked_accounts SET verified_at = datetime('now'), verification_code = NULL WHERE id = ?").run(link.id);

  res.json({ success: true, message: `Discord account linked: ${link.discord_username}` });
});

// ─── Player: Check link status ─────────────────────────────
router.get('/link-status', requireLogin, (req, res) => {

  const link = db.prepare('SELECT discord_username, verified_at FROM discord_linked_accounts WHERE user_id = ?').get(req.user.id);
  res.json(link || { linked: false });
});

// ─── Player: Unlink ────────────────────────────────────────
router.post('/unlink', requireLogin, (req, res) => {

  db.prepare('DELETE FROM discord_linked_accounts WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
