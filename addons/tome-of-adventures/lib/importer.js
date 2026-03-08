/**
 * Adventure Importer — orchestrates the full import process
 *
 * Steps:
 * 1. Fetch adventure JSON from GitHub
 * 2. Create campaign with chapter structure
 * 3. Fetch bestiary and create NPCs with stat blocks
 * 4. Download and create maps
 * 5. Track import in tome_imports table
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const github = require('./github');
const parser = require('./parser');

class AdventureImporter {
  constructor(db, dataDir, userId) {
    this.db = db;
    this.dataDir = dataDir;
    this.userId = userId;
    this.progress = { step: '', percent: 0, detail: '' };
    this._listeners = [];
  }

  onProgress(fn) {
    this._listeners.push(fn);
  }

  _emit(step, percent, detail) {
    this.progress = { step, percent, detail: detail || '' };
    for (const fn of this._listeners) {
      try { fn(this.progress); } catch (e) {}
    }
  }

  /**
   * Run the full import process
   * Returns { campaignId, npcCount, mapCount }
   */
  async import(adventureId, adventureMeta) {
    const results = { campaignId: null, npcCount: 0, mapCount: 0 };

    try {
      // Step 1: Fetch adventure data
      this._emit('fetch', 5, 'Fetching adventure data...');
      const adventureData = await github.fetchAdventure(adventureId);

      // Step 2: Create campaign
      this._emit('campaign', 15, 'Creating campaign...');
      results.campaignId = this._createCampaign(adventureData, adventureMeta);

      // Step 3: Fetch bestiary and create NPCs
      this._emit('npcs', 25, 'Fetching bestiary...');
      const creatureRefs = parser.extractAllCreatures(adventureData);
      this._emit('npcs', 30, `Found ${creatureRefs.length} creature references`);

      // Fetch adventure-specific bestiary
      let monsters = [];
      try {
        const bestiary = await github.fetchBestiary(adventureMeta.source || adventureId);
        monsters = bestiary.monster || [];
      } catch (e) {
        this._emit('npcs', 35, 'No adventure-specific bestiary, using core...');
      }

      // Also fetch core MM for common creatures
      let coreMonsters = [];
      try {
        this._emit('npcs', 35, 'Fetching core bestiary...');
        const coreBestiary = await github.fetchCoreBestiary();
        coreMonsters = coreBestiary.monster || [];
      } catch (e) {
        // Non-fatal
      }

      // Build lookup map
      const monsterMap = new Map();
      for (const m of coreMonsters) {
        monsterMap.set(m.name.toLowerCase(), m);
      }
      for (const m of monsters) {
        monsterMap.set(m.name.toLowerCase(), m); // Adventure monsters override core
      }

      // Create NPCs
      this._emit('npcs', 40, 'Creating NPCs...');
      const npcCategory = this._getOrCreateNpcCategory(adventureMeta.name);
      const totalCreatures = creatureRefs.length;
      let createdCount = 0;

      for (let i = 0; i < creatureRefs.length; i++) {
        const ref = creatureRefs[i];
        const pct = 40 + Math.round((i / totalCreatures) * 25);
        this._emit('npcs', pct, `Creating NPC: ${ref.name} (${i + 1}/${totalCreatures})`);

        const monster = monsterMap.get(ref.name.toLowerCase());
        if (monster) {
          const created = await this._createNpc(monster, npcCategory, results.campaignId);
          if (created) createdCount++;
        }
      }
      results.npcCount = createdCount;

      // Step 4: Extract and import maps
      this._emit('maps', 65, 'Extracting maps...');
      const mapRefs = parser.extractMaps(adventureData.data);
      this._emit('maps', 68, `Found ${mapRefs.length} maps`);

      const totalMaps = mapRefs.length;
      let mapsCreated = 0;

      for (let i = 0; i < mapRefs.length; i++) {
        const mapRef = mapRefs[i];
        const pct = 70 + Math.round((i / Math.max(totalMaps, 1)) * 25);
        this._emit('maps', pct, `Importing map: ${mapRef.title || 'Map ' + (i + 1)} (${i + 1}/${totalMaps})`);

        try {
          const created = await this._importMap(mapRef, results.campaignId);
          if (created) mapsCreated++;
        } catch (e) {
          console.error(`[Tome] Failed to import map ${mapRef.path}:`, e.message);
        }
      }
      results.mapCount = mapsCreated;

      // Step 5: Track import
      this._emit('done', 98, 'Saving import record...');
      this._trackImport(adventureId, adventureMeta.name, results);

      this._emit('done', 100, `Import complete! Campaign: ${adventureMeta.name}, ${results.npcCount} NPCs, ${results.mapCount} maps`);

      return results;
    } catch (err) {
      this._emit('error', -1, err.message);
      throw err;
    }
  }

  /**
   * Re-import: update existing campaign, merge NPCs and maps
   */
  async reimport(adventureId, adventureMeta, existingImport) {
    // For re-import, we essentially run the same process but skip duplicates
    // The _createNpc and _importMap methods check for existing records
    return this.import(adventureId, adventureMeta);
  }

  // --- Private Methods ---

  _createCampaign(adventureData, meta) {
    // Check if campaign already exists for this adventure
    const existing = this.db.prepare(
      'SELECT campaign_id FROM tome_imports WHERE adventure_id = ?'
    ).get(meta.id);

    if (existing && existing.campaign_id) {
      // Update existing campaign
      const chapters = parser.extractChapters(adventureData);
      const description = this._buildCampaignDescription(meta, chapters);
      this.db.prepare('UPDATE campaigns SET description = ? WHERE id = ?')
        .run(description, existing.campaign_id);
      return existing.campaign_id;
    }

    // Create new campaign
    const chapters = parser.extractChapters(adventureData);
    const description = this._buildCampaignDescription(meta, chapters);

    const levelText = meta.level
      ? `Levels ${meta.level.start}-${meta.level.end}`
      : '';

    const result = this.db.prepare(`
      INSERT INTO campaigns (name, description, created_by, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(
      meta.name,
      description,
      this.userId
    );

    return result.lastInsertRowid;
  }

  _buildCampaignDescription(meta, chapters) {
    let desc = '';

    if (meta.author) desc += `**Author:** ${meta.author}\n`;
    if (meta.level) desc += `**Levels:** ${meta.level.start}–${meta.level.end}\n`;
    desc += '\n---\n\n';

    // Filter out intro/credits sections, keep only actual adventure chapters
    const adventureChapters = chapters.filter(ch => {
      const lower = ch.name.toLowerCase();
      return lower !== 'credits' && lower !== 'appendix';
    });

    if (adventureChapters.length > 0) {
      desc += '## Chapters\n\n';
      for (let i = 0; i < adventureChapters.length; i++) {
        const ch = adventureChapters[i];
        desc += `${i + 1}. **${ch.name}**`;
        if (ch.level) desc += ` *(${ch.level})*`;
        desc += '\n';
      }
    }

    return desc.trim();
  }

  _getOrCreateNpcCategory(adventureName) {
    // Check if category exists
    const existing = this.db.prepare(
      "SELECT id FROM npc_categories WHERE name = ?"
    ).get(adventureName);

    if (existing) return existing.id;

    const result = this.db.prepare(
      "INSERT INTO npc_categories (name, created_by) VALUES (?, ?)"
    ).run(adventureName, this.userId);

    return result.lastInsertRowid;
  }

  async _createNpc(monster, categoryId, campaignId) {
    // Check if NPC with this name already exists
    const existing = this.db.prepare(
      'SELECT id FROM npc_tokens WHERE name = ?'
    ).get(monster.name);

    if (existing) return false; // Skip duplicate

    // Build stat block notes
    const notes = this._buildStatBlock(monster);

    // Calculate HP
    const hp = monster.hp ? (monster.hp.average || 0) : 0;

    // Try to fetch avatar from D&D 5e SRD API
    let avatarFile = null;
    try {
      avatarFile = await this._fetchNpcAvatar(monster.name);
    } catch (e) {
      // Non-fatal — NPC just won't have an avatar
    }

    this.db.prepare(`
      INSERT INTO npc_tokens (name, avatar, current_hp, max_hp, notes, category_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      monster.name,
      avatarFile,
      hp,
      hp,
      notes,
      categoryId,
      this.userId
    );

    return true;
  }

  /**
   * Fetch NPC avatar from D&D 5e SRD API (dnd5eapi.co)
   * Returns avatar filename or null
   */
  async _fetchNpcAvatar(monsterName) {
    const slug = monsterName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const apiUrl = `https://www.dnd5eapi.co/api/monsters/${encodeURIComponent(slug)}`;

    // Step 1: Check if monster has an image
    const monsterData = await new Promise((resolve, reject) => {
      https.get(apiUrl, { timeout: 5000 }, (resp) => {
        if (resp.statusCode !== 200) return resolve(null);
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    if (!monsterData || !monsterData.image) return null;

    // Step 2: Download the image
    const imageUrl = 'https://www.dnd5eapi.co' + monsterData.image;
    const avatarsDir = path.join(this.dataDir, 'avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

    return new Promise((resolve) => {
      https.get(imageUrl, { timeout: 8000 }, (resp) => {
        if (resp.statusCode !== 200) return resolve(null);
        const ct = resp.headers['content-type'] || '';
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
        const ext = extMap[ct.split(';')[0].trim()] || '.png';
        const fname = 'npc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6) + ext;
        const fpath = path.join(avatarsDir, fname);
        const ws = fs.createWriteStream(fpath);
        resp.pipe(ws);
        ws.on('finish', () => resolve(fname));
        ws.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    });
  }

  _buildStatBlock(monster) {
    const parts = [];

    // Type and size
    if (monster.size || monster.type) {
      const size = Array.isArray(monster.size) ? monster.size[0] : (monster.size || '');
      const sizeMap = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
      const sizeText = sizeMap[size] || size;
      let typeText = '';
      if (typeof monster.type === 'string') {
        typeText = monster.type;
      } else if (monster.type && monster.type.type) {
        typeText = monster.type.type;
        if (monster.type.tags) typeText += ' (' + monster.type.tags.join(', ') + ')';
      }
      parts.push(`${sizeText} ${typeText}`.trim());
    }

    // AC
    if (monster.ac) {
      const ac = Array.isArray(monster.ac) ? monster.ac[0] : monster.ac;
      const acVal = typeof ac === 'object' ? (ac.ac || ac) : ac;
      const acFrom = typeof ac === 'object' && ac.from ? ' (' + ac.from.join(', ') + ')' : '';
      parts.push(`AC: ${acVal}${acFrom}`);
    }

    // HP
    if (monster.hp) {
      const hpText = monster.hp.average ? `${monster.hp.average}` : '';
      const hpFormula = monster.hp.formula ? ` (${monster.hp.formula})` : '';
      if (hpText) parts.push(`HP: ${hpText}${hpFormula}`);
    }

    // Speed
    if (monster.speed) {
      const speeds = [];
      for (const [type, val] of Object.entries(monster.speed)) {
        if (type === 'canHover') continue;
        const v = typeof val === 'object' ? val.number : val;
        speeds.push(type === 'walk' ? `${v} ft.` : `${type} ${v} ft.`);
      }
      if (speeds.length) parts.push(`Speed: ${speeds.join(', ')}`);
    }

    // Ability scores
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const scores = abilities.map(a => {
      const val = monster[a] || 10;
      const mod = Math.floor((val - 10) / 2);
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      return `${a.toUpperCase()}: ${val} (${modStr})`;
    });
    parts.push(scores.join(' | '));

    // CR
    if (monster.cr) {
      const cr = typeof monster.cr === 'object' ? monster.cr.cr : monster.cr;
      parts.push(`CR: ${cr}`);
    }

    // Traits
    if (monster.trait) {
      parts.push('\n--- Traits ---');
      for (const trait of monster.trait) {
        const name = trait.name || '';
        const text = parser.entryToText(trait.entries);
        parts.push(`${name}: ${text}`);
      }
    }

    // Actions
    if (monster.action) {
      parts.push('\n--- Actions ---');
      for (const action of monster.action) {
        const name = action.name || '';
        const text = parser.entryToText(action.entries);
        parts.push(`${name}: ${text}`);
      }
    }

    // Legendary Actions
    if (monster.legendary) {
      parts.push('\n--- Legendary Actions ---');
      for (const la of monster.legendary) {
        const name = la.name || '';
        const text = parser.entryToText(la.entries);
        parts.push(`${name}: ${text}`);
      }
    }

    return parts.join('\n');
  }

  _parseAlignment(alignment) {
    if (!alignment) return 'neutral';
    if (Array.isArray(alignment)) {
      const map = { L: 'lawful', N: 'neutral', NX: 'neutral', NY: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any' };
      return alignment.map(a => {
        if (typeof a === 'string') return map[a] || a;
        if (a.alignment) return this._parseAlignment(a.alignment);
        return 'neutral';
      }).join(' ');
    }
    return 'neutral';
  }

  async _importMap(mapRef, campaignId) {
    // Check if map with same name already imported by this user
    const mapName = mapRef.title || path.basename(mapRef.path, path.extname(mapRef.path));
    const existingMap = this.db.prepare(
      "SELECT id FROM maps WHERE name = ? AND created_by = ?"
    ).get(mapName, this.userId);

    if (existingMap) return false;

    // Download image
    let imageBuffer;
    try {
      imageBuffer = await github.fetchImage(mapRef.path);
    } catch (e) {
      console.error(`[Tome] Failed to download map image: ${mapRef.path}`, e.message);
      return false;
    }

    // Save image to data/maps/ (served via /maps/ static route)
    const mapsDir = path.join(this.dataDir, 'maps');
    if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

    const ext = path.extname(mapRef.path) || '.webp';
    const filename = `tome-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    const filePath = path.join(mapsDir, filename);
    fs.writeFileSync(filePath, imageBuffer);

    // Create map record — image_path stores just the filename
    this.db.prepare(`
      INSERT INTO maps (name, image_path, campaign_id, created_by, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      mapName,
      filename,
      campaignId,
      this.userId
    );

    return true;
  }

  _trackImport(adventureId, adventureName, results) {
    this.db.prepare(`
      INSERT OR REPLACE INTO tome_imports (adventure_id, adventure_name, campaign_id, import_version, npc_count, map_count, status)
      VALUES (?, ?, ?, ?, ?, ?, 'complete')
    `).run(
      adventureId,
      adventureName,
      results.campaignId,
      '1.0.0',
      results.npcCount,
      results.mapCount
    );
  }
}

module.exports = AdventureImporter;
