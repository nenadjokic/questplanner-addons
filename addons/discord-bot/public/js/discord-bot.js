/* ─── Discord Bot Addon Client JS ─────────────────────── */

function getCsrf() {
  const el = document.querySelector('meta[name="csrf-token"]') || document.querySelector('input[name="_csrf"]');
  return el ? (el.content || el.value) : '';
}

function postJson(url, data) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
    body: JSON.stringify(data || {})
  });
}

function deleteReq(url) {
  return fetch(url, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': getCsrf() }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  loadLinkedAccounts();

  // Poll bot status every 15s on the settings page
  if (document.getElementById('bot-status-text')) {
    setInterval(pollBotStatus, 15000);
  }
});

function showToast(msg, type) {
  let toast = document.getElementById('discord-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'discord-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = type;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 3000);
}

async function saveSettings(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    bot_token: form.bot_token.value,
    guild_id: form.guild_id.value,
    notification_channel_id: form.notification_channel_id.value,
    dice_channel_id: form.dice_channel_id.value,
    enable_slash_commands: form.enable_slash_commands.checked ? 1 : 0,
    enable_emoji_rsvp: form.enable_emoji_rsvp.checked ? 1 : 0,
    enable_dice_feed: form.enable_dice_feed.checked ? 1 : 0,
    enable_live_notifications: form.enable_live_notifications.checked ? 1 : 0
  };

  try {
    const res = await postJson('/discord-bot/settings', data);
    const json = await res.json();
    showToast(json.message || 'Saved!', json.success ? 'success' : 'error');
    if (json.success) setTimeout(() => location.reload(), 1000);
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
}

async function controlBot(action) {
  try {
    const res = await postJson('/discord-bot/' + action);
    const json = await res.json();
    showToast(action === 'start' ? 'Bot starting...' : 'Bot stopped.', json.success ? 'success' : 'error');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    showToast('Failed to ' + action + ' bot', 'error');
  }
}

async function testNotification() {
  try {
    const res = await postJson('/discord-bot/test');
    const json = await res.json();
    showToast(json.message, json.success ? 'success' : 'error');
  } catch (err) {
    showToast('Failed to send test', 'error');
  }
}

async function pollBotStatus() {
  try {
    const res = await fetch('/discord-bot/status');
    const json = await res.json();
    const el = document.getElementById('bot-status-text');
    if (el) {
      el.textContent = json.status === 'online' ? 'Online' : json.status === 'connecting' ? 'Connecting...' : 'Offline';
    }
    const indicator = document.querySelector('.discord-status-indicator');
    if (indicator) {
      indicator.className = 'discord-status-indicator ' + (json.status === 'online' ? 'online' : json.status === 'connecting' ? 'connecting' : 'offline');
    }
    const usernameEl = document.getElementById('bot-username');
    if (usernameEl && json.username) {
      usernameEl.textContent = json.username;
    }
  } catch (e) { /* ignore */ }
}

async function loadLinkedAccounts() {
  const container = document.getElementById('linked-accounts-list');
  if (!container) return;

  try {
    const res = await fetch('/discord-bot/linked-accounts');
    const accounts = await res.json();

    if (!accounts.length) {
      container.innerHTML = '<p class="text-muted">No accounts linked yet. Players can link by typing <code>/quest link &lt;username&gt;</code> in Discord.</p>';
      return;
    }

    let html = '<table class="linked-accounts-table"><thead><tr><th>Player</th><th>Discord</th><th>Status</th><th></th></tr></thead><tbody>';
    for (const a of accounts) {
      const name = a.username;
      const status = a.verified_at
        ? '<span class="status-verified">Verified</span>'
        : '<span class="status-pending">Pending</span>';
      html += `<tr>
        <td>${escHtml(name)}</td>
        <td><code>${escHtml(a.discord_username || a.discord_user_id)}</code></td>
        <td>${status}</td>
        <td><button class="btn btn-sm btn-danger" onclick="unlinkAccount(${a.id})">Unlink</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p class="text-muted">Failed to load accounts.</p>';
  }
}

async function unlinkAccount(id) {
  if (!confirm('Unlink this Discord account?')) return;
  try {
    await deleteReq('/discord-bot/linked-accounts/' + id);
    loadLinkedAccounts();
    showToast('Account unlinked', 'success');
  } catch (e) {
    showToast('Failed to unlink', 'error');
  }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
