'use strict';

class ViberNotifier {
  constructor(db) {
    this.db = db;
  }

  getSettings() {
    return this.db.prepare('SELECT * FROM viber_bot_settings WHERE id = 1').get();
  }

  async sendNotification(type, data) {
    const settings = this.getSettings();
    if (!settings || !settings.enabled || !settings.auth_token || !settings.admin_id) return;

    const message = this._formatMessage(type, data, settings.public_url);
    if (!message) return;

    try {
      const axios = require('axios');
      const body = this._buildBody(message, settings.admin_id, settings.auth_token);
      await axios.post('https://chatapi.viber.com/pa/send_message', body, {
        headers: { 'X-Viber-Auth-Token': settings.auth_token }
      });
    } catch (err) {
      console.error(`[viber-bot] Failed to send ${type}:`, err.message);
    }
  }

  async test() {
    const settings = this.getSettings();
    if (!settings || !settings.auth_token || !settings.admin_id) {
      throw new Error('Auth token and admin ID are required');
    }

    const axios = require('axios');
    await axios.post('https://chatapi.viber.com/pa/send_message', {
      receiver: settings.admin_id,
      type: 'text',
      text: '🏰 Connection Test\nHello from Quest Planner! Connection verified.'
    }, {
      headers: { 'X-Viber-Auth-Token': settings.auth_token }
    });
  }

  async registerWebhook(publicUrl) {
    const settings = this.getSettings();
    if (!settings || !settings.auth_token || !publicUrl) return;

    const axios = require('axios');
    const webhookUrl = publicUrl.replace(/\/+$/, '') + '/webhooks/viber';
    await axios.post('https://chatapi.viber.com/pa/set_webhook', {
      url: webhookUrl,
      event_types: ['delivered', 'seen']
    }, {
      headers: { 'X-Viber-Auth-Token': settings.auth_token }
    });
  }

  _formatMessage(type, data, publicUrl) {
    const link = this._buildLink(data.link, publicUrl);

    switch (type) {
      case 'session_created':
      case 'session_reopened': {
        const dates = (data.slotDates || []).join(', ');
        return { emoji: '📅', title: 'New Quest', text: `New Quest: "${data.title}" — Vote now!${dates ? '\nDates: ' + dates : ''}`, link };
      }
      case 'session_confirmed':
        return { emoji: '✅', title: 'Quest Confirmed', text: `Quest Confirmed: "${data.title}" on ${data.date || ''} at ${data.time || ''}`, link };
      case 'session_cancelled':
        return { emoji: '❌', title: 'Quest Cancelled', text: `Quest Cancelled: "${data.title}"`, link };
      case 'session_completed':
        return { emoji: '📜', title: 'Quest Complete', text: `Quest Complete: "${data.title}"${data.summary ? '\n' + data.summary.substring(0, 200) : ''}`, link };
      case 'session_recap':
        return { emoji: '📜', title: 'Recap Updated', text: `Recap updated for: "${data.title}"`, link };
      case 'session_reminder':
        return { emoji: '⏰', title: 'Quest Reminder', text: `Reminder: "${data.title}" starts in ${data.timeUntil}!`, link };
      default:
        return null;
    }
  }

  _buildBody(message, receiverId, authToken) {
    if (message.link) {
      return {
        receiver: receiverId,
        type: 'rich_media',
        rich_media: {
          Type: 'rich_media',
          ButtonsGroupColumns: 6,
          ButtonsGroupRows: 2,
          BgColor: '#1a1a2e',
          Buttons: [
            {
              ActionBody: message.link,
              ActionType: 'open-url',
              Text: `<b>${message.emoji} ${message.title}</b><br>${message.text}`,
              TextSize: 'medium',
              TextVAlign: 'middle',
              TextHAlign: 'left',
              Rows: 1,
              Columns: 6
            },
            {
              ActionBody: message.link,
              ActionType: 'open-url',
              Text: 'Open in Quest Planner',
              TextSize: 'small',
              Rows: 1,
              Columns: 6
            }
          ]
        }
      };
    }

    return {
      receiver: receiverId,
      type: 'text',
      text: `${message.emoji} ${message.title}\n${message.text}`
    };
  }

  _buildLink(relativePath, publicUrl) {
    if (!relativePath || !publicUrl) return null;
    return publicUrl.replace(/\/+$/, '') + relativePath;
  }
}

module.exports = ViberNotifier;
