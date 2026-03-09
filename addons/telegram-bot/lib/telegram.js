'use strict';

class TelegramNotifier {
  constructor(db) {
    this.db = db;
  }

  getSettings() {
    return this.db.prepare('SELECT * FROM telegram_bot_settings WHERE id = 1').get();
  }

  async sendNotification(type, data) {
    const settings = this.getSettings();
    if (!settings || !settings.enabled || !settings.bot_token || !settings.chat_id) return;

    const message = this._formatMessage(type, data, settings.public_url);
    if (!message) return;

    try {
      const TelegramBot = require('node-telegram-bot-api');
      const bot = new TelegramBot(settings.bot_token);
      await bot.sendMessage(settings.chat_id, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`[telegram-bot] Failed to send ${type}:`, err.message);
    }
  }

  async test() {
    const settings = this.getSettings();
    if (!settings || !settings.bot_token || !settings.chat_id) {
      throw new Error('Bot token and chat ID are required');
    }

    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(settings.bot_token);
    await bot.sendMessage(settings.chat_id, '<b>🏰 Connection Test</b>\nHello from Quest Planner! Connection verified.', { parse_mode: 'HTML' });
  }

  _formatMessage(type, data, publicUrl) {
    const link = this._buildLink(data.link, publicUrl);
    const linkHtml = link ? `\n\n<a href="${link}">Open in Quest Planner</a>` : '';

    switch (type) {
      case 'session_created':
      case 'session_reopened': {
        const slotLines = (data.slotDates || []).map((d, i) => `  ${i + 1}. ${d}`).join('\n');
        const dates = slotLines ? `\n\nProposed dates:\n${slotLines}` : '';
        return `<b>📅 New Quest: "${data.title}"</b>\nVote now!${dates}${linkHtml}`;
      }
      case 'session_confirmed': {
        let details = '';
        if (data.label) details += `\nTime: ${data.label}`;
        if (data.date) details += `\nDate: ${data.date}`;
        if (data.playerList && data.playerList.length) details += `\nPlayers: ${data.playerList.join(', ')}`;
        if (data.mapName) details += `\nLocation: ${data.mapName}`;
        return `<b>✅ Quest Confirmed: "${data.title}"</b>${details}${linkHtml}`;
      }
      case 'session_cancelled':
        return `<b>❌ Quest Cancelled: "${data.title}"</b>${linkHtml}`;
      case 'session_completed': {
        const summary = data.summary ? `\n${data.summary.length > 300 ? data.summary.substring(0, 300) + '...' : data.summary}` : '';
        return `<b>📜 Quest Complete: "${data.title}"</b>${summary}${linkHtml}`;
      }
      case 'session_recap': {
        const recap = data.summary ? `\n${data.summary.length > 300 ? data.summary.substring(0, 300) + '...' : data.summary}` : '';
        return `<b>📜 Recap Updated: "${data.title}"</b>${recap}${linkHtml}`;
      }
      case 'session_reminder': {
        let players = '';
        if (data.playerList && data.playerList.length) players = `\nPlayers: ${data.playerList.join(', ')}`;
        return `<b>⏰ Quest Reminder: "${data.title}"</b>\nStarts in ${data.timeUntil}!${players}${linkHtml}`;
      }
      default:
        return null;
    }
  }

  _buildLink(relativePath, publicUrl) {
    if (!relativePath || !publicUrl) return null;
    return publicUrl.replace(/\/+$/, '') + relativePath;
  }
}

module.exports = TelegramNotifier;
