module.exports = {
  onLoad(ctx) {
    console.log('[Tome of Adventures] Addon loaded');
  },

  onDisable(ctx) {
    console.log('[Tome of Adventures] Addon disabled');
  },

  onUserDelete(ctx, userId) {
    // Clean up imports created by this user
    try {
      ctx.db.prepare(`
        DELETE FROM tome_imports
        WHERE campaign_id IN (SELECT id FROM campaigns WHERE created_by = ?)
      `).run(userId);
    } catch (e) {
      // Table might not exist
    }
  }
};
