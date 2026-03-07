'use strict';

module.exports = {
  version: 1,
  description: 'Create Discord Bot tables for account linking, settings, and message tracking',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discord_bot_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        bot_token TEXT,
        guild_id TEXT,
        notification_channel_id TEXT,
        dice_channel_id TEXT,
        enable_slash_commands INTEGER DEFAULT 1,
        enable_emoji_rsvp INTEGER DEFAULT 1,
        enable_dice_feed INTEGER DEFAULT 0,
        enable_live_notifications INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO discord_bot_settings (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS discord_linked_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        discord_user_id TEXT NOT NULL UNIQUE,
        discord_username TEXT,
        verification_code TEXT,
        verified_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS discord_rsvp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        slot_mapping TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  },

  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS discord_rsvp_messages;
      DROP TABLE IF EXISTS discord_linked_accounts;
      DROP TABLE IF EXISTS discord_bot_settings;
    `);
  }
};
