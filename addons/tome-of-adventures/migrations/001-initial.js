module.exports = {
  version: 1,
  description: 'Create tome_imports table for tracking imported adventures',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tome_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adventure_id TEXT NOT NULL UNIQUE,
        adventure_name TEXT NOT NULL,
        campaign_id INTEGER,
        imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        import_version TEXT,
        npc_count INTEGER DEFAULT 0,
        map_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'complete'
      );
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS tome_imports;');
  }
};
