'use strict';

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class QuestPlannerBot {
  constructor(ctx) {
    this.db = ctx.db;
    this.sse = ctx.sse;
    this.client = null;
    this.ready = false;
    this._destroyed = false;
  }

  getSettings() {
    return this.db.prepare('SELECT * FROM discord_bot_settings WHERE id = 1').get();
  }

  async start() {
    const settings = this.getSettings();
    if (!settings || !settings.bot_token || !settings.guild_id) {
      console.log('[discord-bot] No bot token or guild ID configured, skipping start');
      return false;
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMessageReactions,
          GatewayIntentBits.MessageContent
        ]
      });

      this.client.once('ready', () => {
        console.log(`[discord-bot] Bot logged in as ${this.client.user.tag}`);
        this.ready = true;
      });

      // Register event handlers
      this._setupInteractionHandler(settings);
      if (settings.enable_emoji_rsvp) {
        this._setupReactionHandler();
      }

      await this.client.login(settings.bot_token);

      // Register slash commands
      if (settings.enable_slash_commands) {
        await this._registerSlashCommands(settings);
      }

      return true;
    } catch (err) {
      console.error('[discord-bot] Failed to start:', err.message);
      this.ready = false;
      return false;
    }
  }

  async stop() {
    this._destroyed = true;
    if (this.client) {
      try {
        this.client.removeAllListeners();
        await this.client.destroy();
      } catch (e) { /* ignore */ }
      this.client = null;
      this.ready = false;
      console.log('[discord-bot] Bot disconnected');
    }
  }

  async restart() {
    await this.stop();
    this._destroyed = false;
    return this.start();
  }

  // ─── Slash Command Registration ──────────────────────────
  async _registerSlashCommands(settings) {
    const commands = [
      new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Quest Planner commands')
        .addSubcommand(sub => sub.setName('next').setDescription('Show the next scheduled session'))
        .addSubcommand(sub => sub.setName('recap').setDescription('Show the latest session recap'))
        .addSubcommand(sub => sub.setName('party').setDescription('Show party members'))
        .addSubcommand(sub => sub.setName('status').setDescription('Campaign overview'))
        .addSubcommand(sub => sub.setName('loot').setDescription('Show party loot inventory'))
        .addSubcommand(sub => sub.setName('vote').setDescription('Get RSVP link for next session'))
        .addSubcommand(sub =>
          sub.setName('roll')
            .setDescription('Roll dice')
            .addStringOption(opt => opt.setName('dice').setDescription('Dice notation (e.g. 2d20+5)').setRequired(true))
            .addStringOption(opt => opt.setName('label').setDescription('Roll label (e.g. Attack Roll)'))
        )
        .addSubcommand(sub =>
          sub.setName('npc')
            .setDescription('Look up an NPC')
            .addStringOption(opt => opt.setName('name').setDescription('NPC name to search').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('link')
            .setDescription('Link your Discord account to Quest Planner')
            .addStringOption(opt => opt.setName('username').setDescription('Your Quest Planner username').setRequired(true))
        )
    ];

    const rest = new REST({ version: '10' }).setToken(settings.bot_token);
    try {
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, settings.guild_id),
        { body: commands.map(c => c.toJSON()) }
      );
      console.log('[discord-bot] Slash commands registered');
    } catch (err) {
      console.error('[discord-bot] Failed to register commands:', err.message);
    }
  }

  // ─── Interaction Handler (Slash Commands) ────────────────
  _setupInteractionHandler(settings) {
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'quest') return;

      const sub = interaction.options.getSubcommand();

      try {
        switch (sub) {
          case 'next':    return await this._cmdNext(interaction);
          case 'recap':   return await this._cmdRecap(interaction);
          case 'party':   return await this._cmdParty(interaction);
          case 'status':  return await this._cmdStatus(interaction);
          case 'loot':    return await this._cmdLoot(interaction);
          case 'vote':    return await this._cmdVote(interaction);
          case 'roll':    return await this._cmdRoll(interaction, settings);
          case 'npc':     return await this._cmdNpc(interaction);
          case 'link':    return await this._cmdLink(interaction);
          default:
            await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        }
      } catch (err) {
        console.error(`[discord-bot] Command /${sub} error:`, err);
        const msg = { content: 'Something went wrong. Try again later.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg);
        } else {
          await interaction.reply(msg);
        }
      }
    });
  }

  // ─── /quest next ─────────────────────────────────────────
  async _cmdNext(interaction) {
    const session = this.db.prepare(`
      SELECT s.*, sl.date_time, sl.label
      FROM sessions s
      LEFT JOIN slots sl ON sl.id = s.confirmed_slot_id
      WHERE s.status IN ('open', 'confirmed')
      ORDER BY CASE s.status WHEN 'confirmed' THEN 0 ELSE 1 END,
               sl.date_time ASC
      LIMIT 1
    `).get();

    if (!session) {
      return interaction.reply({ content: 'No upcoming sessions scheduled.', ephemeral: true });
    }

    const slots = this.db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(session.id);
    const votes = this.db.prepare(`
      SELECT v.slot_id, COUNT(*) as count
      FROM votes v
      WHERE v.slot_id IN (${slots.map(() => '?').join(',')}) AND v.status = 'available'
      GROUP BY v.slot_id
    `).all(...slots.map(s => s.id));

    const voteMap = {};
    for (const v of votes) voteMap[v.slot_id] = v.count;

    const totalPlayers = this.db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'admin'").get().c;

    const embed = new EmbedBuilder()
      .setColor(session.status === 'confirmed' ? 0x2ecc71 : 0xd4a843)
      .setTitle(`${session.status === 'confirmed' ? '✅' : '📅'} ${session.title}`)
      .setDescription(session.description || 'No description');

    if (session.status === 'confirmed' && session.date_time) {
      const d = new Date(session.date_time);
      embed.addFields({ name: 'Date', value: `<t:${Math.floor(d.getTime() / 1000)}:F>`, inline: true });
    } else {
      const slotLines = slots.map((s, i) => {
        const d = new Date(s.date_time);
        const count = voteMap[s.id] || 0;
        return `${i + 1}️⃣ <t:${Math.floor(d.getTime() / 1000)}:F> — ${count}/${totalPlayers} available`;
      });
      embed.addFields({ name: 'Proposed Dates', value: slotLines.join('\n') || 'None' });
    }

    embed.addFields({ name: 'Status', value: session.status.charAt(0).toUpperCase() + session.status.slice(1), inline: true });

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest recap ────────────────────────────────────────
  async _cmdRecap(interaction) {
    const session = this.db.prepare(`
      SELECT s.title, s.summary, sl.date_time
      FROM sessions s
      LEFT JOIN slots sl ON sl.id = s.confirmed_slot_id
      WHERE s.status = 'completed' AND s.summary IS NOT NULL
      ORDER BY sl.date_time DESC
      LIMIT 1
    `).get();

    if (!session) {
      return interaction.reply({ content: 'No session recaps available yet.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`📜 Previously On... ${session.title}`)
      .setDescription(session.summary.length > 4000 ? session.summary.slice(0, 4000) + '...' : session.summary);

    if (session.date_time) {
      const d = new Date(session.date_time);
      embed.setFooter({ text: `Session on ${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` });
    }

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest party ────────────────────────────────────────
  async _cmdParty(interaction) {
    const players = this.db.prepare(`
      SELECT u.username, u.display_name, c.name as char_name, c.class as char_class, c.level as char_level
      FROM users u
      LEFT JOIN characters c ON c.user_id = u.id
      WHERE u.role != 'admin'
      ORDER BY u.username
    `).all();

    if (!players.length) {
      return interaction.reply({ content: 'No players registered yet.', ephemeral: true });
    }

    const lines = players.map(p => {
      const name = p.display_name || p.username;
      if (p.char_name) {
        return `**${p.char_name}** (${p.char_class || '?'} Lv${p.char_level || '?'}) — ${name}`;
      }
      return `**${name}** — No character`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('⚔️ The Party')
      .setDescription(lines.join('\n'));

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest status ───────────────────────────────────────
  async _cmdStatus(interaction) {
    const stats = {
      sessions: this.db.prepare("SELECT COUNT(*) as c FROM sessions WHERE status = 'completed'").get().c,
      activeQuests: this.db.prepare("SELECT COUNT(*) as c FROM quests WHERE status = 'active'").get()?.c || 0,
      players: this.db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'admin'").get().c
    };

    // Try to get party treasury
    let treasury = '';
    try {
      const gold = this.db.prepare('SELECT gp FROM party_currency WHERE id = 1').get();
      if (gold) treasury = `\n💰 Treasury: ${gold.gp || 0} GP`;
    } catch (e) { /* loot addon may not be enabled */ }

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('📊 Campaign Status')
      .setDescription(
        `🎭 **${stats.players}** players\n` +
        `📅 **${stats.sessions}** sessions completed\n` +
        `📜 **${stats.activeQuests}** active quests` +
        treasury
      );

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest loot ─────────────────────────────────────────
  async _cmdLoot(interaction) {
    let items;
    try {
      items = this.db.prepare(`
        SELECT li.name, li.rarity, u.username as holder
        FROM loot_items li
        LEFT JOIN users u ON li.held_by = u.id
        WHERE li.hidden = 0
        ORDER BY li.rarity DESC, li.name
        LIMIT 20
      `).all();
    } catch (e) {
      return interaction.reply({ content: 'Loot tracker is not enabled.', ephemeral: true });
    }

    if (!items.length) {
      return interaction.reply({ content: 'No loot in party inventory.', ephemeral: true });
    }

    const rarityEmoji = { common: '⬜', uncommon: '🟢', rare: '🔵', 'very rare': '🟣', legendary: '🟡', artifact: '🔴' };
    const lines = items.map(i => {
      const emoji = rarityEmoji[(i.rarity || 'common').toLowerCase()] || '⬜';
      const holder = i.holder ? ` (${i.holder})` : '';
      return `${emoji} ${i.name}${holder}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('💰 Party Loot')
      .setDescription(lines.join('\n'));

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest vote ─────────────────────────────────────────
  async _cmdVote(interaction) {
    const session = this.db.prepare(`
      SELECT * FROM sessions WHERE status = 'open' ORDER BY created_at DESC LIMIT 1
    `).get();

    if (!session) {
      return interaction.reply({ content: 'No open sessions to vote on.', ephemeral: true });
    }

    const settings = this.getSettings();
    const publicUrl = this.db.prepare('SELECT public_url FROM notification_config WHERE id = 1').get()?.public_url;

    if (publicUrl) {
      await interaction.reply(`📅 **${session.title}** is open for voting!\n\n🔗 Vote here: ${publicUrl}/sessions/${session.id}`);
    } else {
      await interaction.reply({ content: `📅 **${session.title}** is open for voting! Check Quest Planner to cast your vote.`, ephemeral: false });
    }
  }

  // ─── /quest roll ─────────────────────────────────────────
  async _cmdRoll(interaction, settings) {
    const notation = interaction.options.getString('dice');
    const label = interaction.options.getString('label');

    const result = this._parseDiceRoll(notation);
    if (!result) {
      return interaction.reply({ content: `Invalid dice notation: \`${notation}\``, ephemeral: true });
    }

    const labelText = label ? ` — ${label}` : '';
    const detailText = result.rolls.length > 1 ? ` (${result.rolls.join(', ')})` : '';

    await interaction.reply(`🎲 **${interaction.user.displayName}** rolled **${result.total}** \`${notation}\`${detailText}${labelText}`);

    // Send to dice channel if enabled
    if (settings.enable_dice_feed && settings.dice_channel_id && settings.dice_channel_id !== settings.notification_channel_id) {
      try {
        const channel = await this.client.channels.fetch(settings.dice_channel_id);
        if (channel) {
          await channel.send(`🎲 **${interaction.user.displayName}** rolled **${result.total}** \`${notation}\`${detailText}${labelText}`);
        }
      } catch (e) { /* ignore */ }
    }
  }

  _parseDiceRoll(notation) {
    const match = notation.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
    if (!match) return null;

    const count = parseInt(match[1] || '1', 10);
    const sides = parseInt(match[2], 10);
    const modifier = parseInt(match[3] || '0', 10);

    if (count < 1 || count > 100 || sides < 1 || sides > 1000) return null;

    const rolls = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    const sum = rolls.reduce((a, b) => a + b, 0);
    return { rolls, total: sum + modifier };
  }

  // ─── /quest npc ──────────────────────────────────────────
  async _cmdNpc(interaction) {
    const name = interaction.options.getString('name');

    const npc = this.db.prepare(`
      SELECT * FROM npc_tokens WHERE name LIKE ? LIMIT 1
    `).get(`%${name}%`);

    if (!npc) {
      return interaction.reply({ content: `No NPC found matching "${name}".`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`👤 ${npc.name}`)
      .setDescription(npc.notes || 'No notes');

    if (npc.hp) embed.addFields({ name: 'HP', value: `${npc.hp}`, inline: true });
    if (npc.ac) embed.addFields({ name: 'AC', value: `${npc.ac}`, inline: true });
    if (npc.cr) embed.addFields({ name: 'CR', value: `${npc.cr}`, inline: true });
    if (npc.alignment) embed.addFields({ name: 'Alignment', value: npc.alignment, inline: true });

    if (npc.avatar_url) {
      embed.setThumbnail(npc.avatar_url);
    }

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /quest link ─────────────────────────────────────────
  async _cmdLink(interaction) {
    const username = interaction.options.getString('username');
    const discordUserId = interaction.user.id;
    const discordUsername = interaction.user.tag;

    // Check if already linked
    const existing = this.db.prepare('SELECT * FROM discord_linked_accounts WHERE discord_user_id = ?').get(discordUserId);
    if (existing && existing.verified_at) {
      const user = this.db.prepare('SELECT username FROM users WHERE id = ?').get(existing.user_id);
      return interaction.reply({ content: `Your Discord account is already linked to **${user?.username || 'unknown'}**.`, ephemeral: true });
    }

    // Find QP user
    const user = this.db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!user) {
      return interaction.reply({ content: `No Quest Planner user found with username "${username}".`, ephemeral: true });
    }

    // Check if QP user already linked to another Discord account
    const otherLink = this.db.prepare('SELECT * FROM discord_linked_accounts WHERE user_id = ? AND discord_user_id != ?').get(user.id, discordUserId);
    if (otherLink && otherLink.verified_at) {
      return interaction.reply({ content: `That Quest Planner account is already linked to another Discord user.`, ephemeral: true });
    }

    // Generate verification code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Upsert linking record
    this.db.prepare(`
      INSERT INTO discord_linked_accounts (user_id, discord_user_id, discord_username, verification_code)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        discord_user_id = excluded.discord_user_id,
        discord_username = excluded.discord_username,
        verification_code = excluded.verification_code,
        verified_at = NULL
    `).run(user.id, discordUserId, discordUsername, code);

    await interaction.reply({
      content: `🔗 To link your account, go to **Quest Planner → Profile** and enter this verification code:\n\n` +
               `**\`${code}\`**\n\n` +
               `This code links your Discord to **${user.username}**.`,
      ephemeral: true
    });
  }

  // ─── Emoji RSVP Reaction Handler ─────────────────────────
  _setupReactionHandler() {
    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;

      // Fetch partial if needed
      if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
      }

      const emojiIndex = numberEmojis.indexOf(reaction.emoji.name);
      if (emojiIndex === -1) return;

      // Check if this message is an RSVP message we track
      const rsvpMsg = this.db.prepare('SELECT * FROM discord_rsvp_messages WHERE message_id = ?').get(reaction.message.id);
      if (!rsvpMsg) return;

      // Find linked QP account
      const link = this.db.prepare('SELECT * FROM discord_linked_accounts WHERE discord_user_id = ? AND verified_at IS NOT NULL').get(user.id);
      if (!link) {
        try {
          await user.send('⚠️ Your Discord account is not linked to Quest Planner. Use `/quest link <username>` to connect.');
        } catch (e) { /* DMs disabled */ }
        return;
      }

      // Parse slot mapping
      const slotMapping = JSON.parse(rsvpMsg.slot_mapping);
      const slotId = slotMapping[emojiIndex];
      if (!slotId) return;

      // Upsert vote
      this.db.prepare(`
        INSERT INTO votes (slot_id, user_id, status)
        VALUES (?, ?, 'available')
        ON CONFLICT(slot_id, user_id) DO UPDATE SET status = 'available'
      `).run(slotId, link.user_id);

      // Broadcast SSE update
      if (this.sse) {
        this.sse.broadcast('session-updated', { sessionId: rsvpMsg.session_id });
      }

      console.log(`[discord-bot] RSVP: ${user.tag} voted available for slot ${slotId} on session ${rsvpMsg.session_id}`);
    });

    // Handle reaction removal (un-vote)
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;

      if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
      }

      const emojiIndex = numberEmojis.indexOf(reaction.emoji.name);
      if (emojiIndex === -1) return;

      const rsvpMsg = this.db.prepare('SELECT * FROM discord_rsvp_messages WHERE message_id = ?').get(reaction.message.id);
      if (!rsvpMsg) return;

      const link = this.db.prepare('SELECT * FROM discord_linked_accounts WHERE discord_user_id = ? AND verified_at IS NOT NULL').get(user.id);
      if (!link) return;

      const slotMapping = JSON.parse(rsvpMsg.slot_mapping);
      const slotId = slotMapping[emojiIndex];
      if (!slotId) return;

      // Remove vote
      this.db.prepare('DELETE FROM votes WHERE slot_id = ? AND user_id = ?').run(slotId, link.user_id);

      if (this.sse) {
        this.sse.broadcast('session-updated', { sessionId: rsvpMsg.session_id });
      }

      console.log(`[discord-bot] RSVP: ${user.tag} removed vote for slot ${slotId} on session ${rsvpMsg.session_id}`);
    });
  }

  // ─── Live Notifications ──────────────────────────────────
  async sendNotification(type, data) {
    const settings = this.getSettings();
    if (!this.ready || !settings.enable_live_notifications || !settings.notification_channel_id) return;

    try {
      const channel = await this.client.channels.fetch(settings.notification_channel_id);
      if (!channel) return;

      const embed = this._buildNotificationEmbed(type, data);
      if (!embed) return;

      const sentMessage = await channel.send({ embeds: [embed] });

      // If this is a session creation with emoji RSVP enabled, add reaction emojis
      if (type === 'session_created' && settings.enable_emoji_rsvp && data.slots && data.slots.length > 0) {
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        const slotMapping = {};

        for (let i = 0; i < Math.min(data.slots.length, 9); i++) {
          await sentMessage.react(numberEmojis[i]);
          slotMapping[i] = data.slots[i].id;
        }

        // Track message for RSVP
        this.db.prepare(`
          INSERT INTO discord_rsvp_messages (session_id, message_id, channel_id, slot_mapping)
          VALUES (?, ?, ?, ?)
        `).run(data.sessionId, sentMessage.id, channel.id, JSON.stringify(slotMapping));
      }

      return sentMessage;
    } catch (err) {
      console.error(`[discord-bot] Failed to send notification (${type}):`, err.message);
    }
  }

  _buildNotificationEmbed(type, data) {
    switch (type) {
      case 'session_created': {
        const slotLines = (data.slots || []).map((s, i) => {
          const d = new Date(s.date_time);
          return `${i + 1}️⃣ ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
        });
        const embed = new EmbedBuilder()
          .setColor(0xd4a843)
          .setTitle(`📅 New Session: ${data.title}`)
          .setDescription(data.description || 'A new quest awaits!');
        if (slotLines.length) {
          embed.addFields({ name: 'Proposed Dates', value: slotLines.join('\n') });
          embed.setFooter({ text: 'React with the number for dates you\'re available!' });
        }
        return embed;
      }

      case 'session_confirmed': {
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(`✅ Session Confirmed: ${data.title}`)
          .setDescription(`**${data.label || data.date}**${data.time ? ` at ${data.time}` : ''}`);
        if (data.playerList && data.playerList.length) {
          embed.addFields({ name: 'Players', value: data.playerList.join(', ') });
        }
        if (data.mapName) {
          embed.addFields({ name: 'Location', value: data.mapName, inline: true });
        }
        return embed;
      }

      case 'session_cancelled':
        return new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(`❌ Session Cancelled: ${data.title}`)
          .setDescription(data.reason || 'The quest has been called off.');

      case 'session_completed':
        return new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`📜 Session Complete: ${data.title}`)
          .setDescription(data.summary ? (data.summary.length > 4000 ? data.summary.slice(0, 4000) + '...' : data.summary) : 'Another chapter in the saga.');

      case 'quest_revealed':
        return new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`📜 New Quest: ${data.title}`)
          .setDescription(data.description || 'A new quest has appeared on the board!');

      case 'loot_revealed':
        return new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`💎 Loot Discovered: ${data.name}`)
          .setDescription(`Rarity: **${data.rarity || 'Unknown'}**`);

      case 'combat_started':
        return new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(`⚔️ Combat Started!`)
          .setDescription(`Battle has begun${data.mapName ? ` on **${data.mapName}**` : ''}!`);

      default:
        return null;
    }
  }

  // ─── Status ──────────────────────────────────────────────
  getStatus() {
    if (!this.client) return 'stopped';
    if (this.ready) return 'online';
    return 'connecting';
  }
}

module.exports = QuestPlannerBot;
