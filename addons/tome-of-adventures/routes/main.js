'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

// Resolve db from app root (works for both addons/ and data/addons/)
const db = require(path.join(process.cwd(), 'db', 'connection'));

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireDM(req, res, next) {
  if (!req.user || !['admin', 'dm'].includes(req.user.role)) {
    return res.status(403).render('404', { message: 'Access denied' });
  }
  next();
}

// Main page — list available adventures
router.get('/', requireLogin, requireDM, (req, res) => {
  const viewPath = path.join(__dirname, '..', 'views', 'tome-of-adventures', 'index');

  // Get previously imported adventures
  let imports = [];
  try {
    imports = db.prepare('SELECT * FROM tome_imports ORDER BY imported_at DESC').all();
  } catch (e) {
    // Table may not exist yet
  }

  res.render(viewPath, {
    pageTitle: 'Tome of Adventures',
    settings: { views: req.app.get('views') },
    imports: imports
  });
});

// API: Fetch adventure list from GitHub
router.get('/api/adventures', requireLogin, requireDM, async (req, res) => {
  try {
    const github = require(path.join(__dirname, '..', 'lib', 'github'));
    const adventures = await github.fetchAdventureIndex();
    res.json({ success: true, adventures });
  } catch (err) {
    console.error('[Tome] Failed to fetch adventures:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// API: Check import status for an adventure
router.get('/api/status/:adventureId', requireLogin, requireDM, (req, res) => {
    try {
    const existing = db.prepare('SELECT * FROM tome_imports WHERE adventure_id = ?').get(req.params.adventureId);
    res.json({ imported: !!existing, data: existing || null });
  } catch (e) {
    res.json({ imported: false, data: null });
  }
});

// API: Start import
router.post('/api/import', requireLogin, requireDM, async (req, res) => {
    const { adventureId, adventureName, source, level, author, storyline } = req.body;

  if (!adventureId) {
    return res.status(400).json({ error: 'Adventure ID is required' });
  }

  // Store import task in global for SSE progress
  const dataDir = path.join(process.cwd(), 'data');
  const AdventureImporter = require(path.join(__dirname, '..', 'lib', 'importer'));
  const importer = new AdventureImporter(db, dataDir, req.user.id);

  // Track progress globally for SSE
  if (!global._tomeImports) global._tomeImports = {};
  global._tomeImports[adventureId] = importer;

  try {
    const meta = {
      id: adventureId,
      name: adventureName || adventureId,
      source: source || adventureId,
      level: level || null,
      author: author || 'Wizards of the Coast',
      storyline: storyline || ''
    };

    const results = await importer.import(adventureId, meta);

    delete global._tomeImports[adventureId];
    res.json({ success: true, ...results });
  } catch (err) {
    delete global._tomeImports[adventureId];
    console.error('[Tome] Import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: SSE progress stream
router.get('/api/progress/:adventureId', requireLogin, requireDM, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const adventureId = req.params.adventureId;
  let lastProgress = '';

  const interval = setInterval(() => {
    if (!global._tomeImports || !global._tomeImports[adventureId]) {
      // Import finished or not started
      res.write(`data: ${JSON.stringify({ step: 'done', percent: 100, detail: 'Complete' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    const importer = global._tomeImports[adventureId];
    const progress = JSON.stringify(importer.progress);
    if (progress !== lastProgress) {
      lastProgress = progress;
      res.write(`data: ${progress}\n\n`);
    }
  }, 200);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// API: Get maps for a campaign (for hierarchy editor)
router.get('/api/maps/:campaignId', requireLogin, requireDM, (req, res) => {
  try {
    const maps = db.prepare(
      'SELECT id, name, parent_id FROM maps WHERE campaign_id = ? ORDER BY name'
    ).all(req.params.campaignId);
    // Also include all other maps (not in this campaign) as potential parents
    const otherMaps = db.prepare(
      'SELECT id, name FROM maps WHERE campaign_id != ? OR campaign_id IS NULL ORDER BY name'
    ).all(req.params.campaignId);
    res.json({ success: true, maps, otherMaps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update map hierarchy (set parent_id for maps)
router.post('/api/maps/hierarchy', requireLogin, requireDM, (req, res) => {
  try {
    const { updates } = req.body; // [{ id, parent_id }]
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'Invalid data' });

    const stmt = db.prepare('UPDATE maps SET parent_id = ? WHERE id = ?');
    const transaction = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.parent_id || null, item.id);
      }
    });
    transaction(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete import — removes campaign, NPCs, maps, and import record
router.delete('/api/import/:adventureId', requireLogin, requireDM, (req, res) => {
  const fs = require('fs');
  const path = require('path');

  // Helper to safely run a query (ignores errors from missing tables/columns)
  function safeRun(sql, ...params) {
    try { db.prepare(sql).run(...params); } catch (e) {}
  }

  try {
    const imp = db.prepare('SELECT * FROM tome_imports WHERE adventure_id = ?').get(req.params.adventureId);
    if (!imp) return res.json({ success: true });

    // Delete campaign and all linked data
    if (imp.campaign_id) {
      // Delete maps linked to this campaign
      const maps = db.prepare('SELECT id, image_path FROM maps WHERE campaign_id = ?').all(imp.campaign_id);
      for (const map of maps) {
        // Delete map image file
        if (map.image_path) {
          try { fs.unlinkSync(path.join(process.cwd(), 'data', 'maps', map.image_path)); } catch (e) {}
        }
        // Delete combat data for this map
        safeRun('DELETE FROM combat_participants WHERE encounter_id IN (SELECT id FROM combat_encounters WHERE map_id = ?)', map.id);
        safeRun('DELETE FROM combat_encounters WHERE map_id = ?', map.id);
        // Delete chest items and chests
        safeRun('DELETE FROM map_chest_items WHERE chest_id IN (SELECT id FROM map_loot_chests WHERE map_id = ?)', map.id);
        safeRun('DELETE FROM map_loot_chests WHERE map_id = ?', map.id);
        // Delete token conditions
        safeRun('DELETE FROM token_conditions WHERE token_id IN (SELECT id FROM map_tokens WHERE map_id = ?)', map.id);
        safeRun('DELETE FROM map_tokens WHERE map_id = ?', map.id);
        // Delete NPC token conditions and vision lines
        safeRun('DELETE FROM npc_token_conditions WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE map_id = ?)', map.id);
        safeRun('DELETE FROM npc_vision_lines WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE map_id = ?)', map.id);
        safeRun('DELETE FROM map_npc_tokens WHERE map_id = ?', map.id);
        // Delete map locations, links, portals
        safeRun('DELETE FROM map_locations WHERE map_id = ?', map.id);
        safeRun('DELETE FROM map_links WHERE from_map_id = ? OR to_map_id = ?', map.id, map.id);
        safeRun('DELETE FROM map_portals WHERE source_map_id = ? OR target_map_id = ?', map.id, map.id);
        // Unset parent references pointing to this map
        safeRun('UPDATE maps SET parent_id = NULL WHERE parent_id = ?', map.id);
      }
      safeRun('DELETE FROM maps WHERE campaign_id = ?', imp.campaign_id);

      // Unlink sessions, quests, loot, etc. from this campaign (don't delete them)
      safeRun('UPDATE sessions SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);
      safeRun('UPDATE quests SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);
      safeRun('UPDATE loot_items SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);
      safeRun('UPDATE handouts SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);
      safeRun('UPDATE encounters SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);
      safeRun('UPDATE campaign_arcs SET campaign_id = NULL WHERE campaign_id = ?', imp.campaign_id);

      safeRun('DELETE FROM campaigns WHERE id = ?', imp.campaign_id);
    }

    // Delete NPCs in the adventure's category
    const cat = db.prepare('SELECT id FROM npc_categories WHERE name = ?').get(imp.adventure_name);
    if (cat) {
      // Get all NPC IDs in this category
      const npcIds = db.prepare('SELECT id FROM npc_tokens WHERE category_id = ?').all(cat.id).map(r => r.id);
      for (const npcId of npcIds) {
        // Clean up NPC references
        safeRun('DELETE FROM npc_token_categories WHERE npc_token_id = ?', npcId);
        safeRun('DELETE FROM npc_token_conditions WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE npc_token_id = ?)', npcId);
        safeRun('DELETE FROM npc_vision_lines WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE npc_token_id = ?)', npcId);
        safeRun('DELETE FROM combat_participants WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE npc_token_id = ?)', npcId);
        safeRun('DELETE FROM map_npc_tokens WHERE npc_token_id = ?', npcId);
        safeRun('UPDATE quests SET quest_giver_npc_id = NULL WHERE quest_giver_npc_id = ?', npcId);
        safeRun('UPDATE loot_items SET linked_npc_id = NULL WHERE linked_npc_id = ?', npcId);
        // Delete avatar file
        try {
          const npc = db.prepare('SELECT avatar FROM npc_tokens WHERE id = ?').get(npcId);
          if (npc && npc.avatar) {
            const avatarPath = path.join(process.cwd(), 'data', 'avatars', npc.avatar);
            try { fs.unlinkSync(avatarPath); } catch (e) {}
          }
        } catch (e) {}
      }
      safeRun('DELETE FROM npc_token_categories WHERE category_id = ?', cat.id);
      safeRun('DELETE FROM npc_tokens WHERE category_id = ?', cat.id);
      safeRun('DELETE FROM npc_categories WHERE id = ?', cat.id);
    }

    // Delete import record
    db.prepare('DELETE FROM tome_imports WHERE adventure_id = ?').run(req.params.adventureId);

    res.json({ success: true });
  } catch (err) {
    console.error('[Tome] Delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
