const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).send('Admin access required');
  next();
}

// Resolve docs directory (works for both preinstalled and community installs)
function getDocsDir() {
  // Check community install path first
  const communityPath = path.join(__dirname, '..', 'docs');
  if (fs.existsSync(communityPath)) return communityPath;
  return communityPath;
}

// Main page
router.get('/', requireAdmin, (req, res) => {
  const viewPath = require('path').join(__dirname, '..', 'views', 'developer-kit', 'developer-kit');
  res.render(viewPath, {
    pageTitle: 'Addon Developer Kit'
  });
});

// Serve documentation markdown
router.get('/docs/:name', requireAdmin, (req, res) => {
  const validDocs = {
    'creating-addons': 'CREATING-ADDONS.md',
    'addon-api': 'ADDON-API.md',
    'submission-guide': 'SUBMISSION-GUIDE.md'
  };

  const filename = validDocs[req.params.name];
  if (!filename) return res.status(404).json({ error: 'Document not found' });

  const docsDir = getDocsDir();
  const filePath = path.join(docsDir, filename);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ name: req.params.name, filename, content });
  } catch (err) {
    res.status(404).json({ error: 'Document not found: ' + err.message });
  }
});

// Download documentation file
router.get('/docs/:name/download', requireAdmin, (req, res) => {
  const validDocs = {
    'creating-addons': 'CREATING-ADDONS.md',
    'addon-api': 'ADDON-API.md',
    'submission-guide': 'SUBMISSION-GUIDE.md',
    'registry': 'registry-template.json'
  };

  const filename = validDocs[req.params.name];
  if (!filename) return res.status(404).send('Not found');

  const docsDir = getDocsDir();
  const filePath = path.join(docsDir, filename);

  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath, filename);
});

// Scaffold — generate .qpa addon package
router.post('/scaffold', requireAdmin, (req, res) => {
  const archiver = require('archiver');
  const config = req.body;

  if (!config.id || !config.name || !config.version) {
    return res.status(400).json({ error: 'id, name, and version are required' });
  }

  const addonId = config.id;

  // Build addon.json manifest
  const manifest = {
    id: addonId,
    name: config.name,
    version: config.version || '1.0.0',
    icon: config.icon || 'puzzle',
    category: config.category || 'Gameplay',
    description: config.description || '',
    author: config.author || 'Your Name',
    type: 'community',
    minAppVersion: '3.0.0'
  };

  if (config.includeRoutes) {
    manifest.routes = [{ path: '/' + addonId, file: 'routes/main.js' }];
    manifest.navItems = [{
      label: config.name,
      href: '/' + addonId,
      icon: config.icon || 'puzzle',
      group: config.navGroup || 'tools',
      sort: 50,
      roles: config.roles || ['admin', 'dm', 'player']
    }];
  }

  if (config.includeWidget) {
    manifest.dashboardWidgets = [{
      id: addonId + '-widget',
      label: config.name,
      position: 'bottom',
      sort: 50,
      template: 'widgets/' + addonId + '-widget.ejs',
      roles: ['admin', 'dm', 'player']
    }];
  }

  if (config.includeCss) {
    manifest.css = ['css/' + addonId + '.css'];
  }
  if (config.includeJs) {
    manifest.js = ['js/' + addonId + '.js'];
  }

  // Set up ZIP archive
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${addonId}-${manifest.version}.qpa"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  // addon.json
  archive.append(JSON.stringify(manifest, null, 2), { name: 'addon.json' });

  // hooks.js
  const hooksContent = `'use strict';

module.exports = {
  onLoad(ctx) {
    console.log('[${config.name}] Addon loaded');
  },

  onDisable(ctx) {
    console.log('[${config.name}] Addon disabled');
  },

  onUserDelete(ctx, userId) {
    // Clean up user data when a user is deleted
    // ctx.db.prepare('DELETE FROM ${addonId.replace(/-/g, '_')}_data WHERE user_id = ?').run(userId);
  }${config.includeWidget ? `,

  getDashboardData(ctx, user, isDM) {
    // Return data for dashboard widgets
    return {
      '${addonId}-widget': {
        items: []
      }
    };
  }` : ''}
};
`;
  archive.append(hooksContent, { name: 'hooks.js' });

  // Migrations
  if (config.includeMigrations) {
    const tableName = addonId.replace(/-/g, '_') + '_data';
    const migrationContent = `'use strict';

module.exports = {
  version: 1,
  description: 'Create ${tableName} table',

  up(db) {
    db.exec(\`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    \`);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS ${tableName}');
  }
};
`;
    archive.append(migrationContent, { name: 'migrations/001-initial.js' });
  }

  // Routes
  if (config.includeRoutes) {
    const routeContent = `const express = require('express');
const path = require('path');
const router = express.Router();

// Middleware: require login (uses req.user set by Quest Planner core)
function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, (req, res) => {
  // const db = req.app.locals.addonManager.db;
  // const items = db.prepare('SELECT * FROM ${addonId.replace(/-/g, '_')}_data ORDER BY created_at DESC').all();
  const viewPath = path.join(__dirname, '..', 'views', '${addonId}', 'index');
  res.render(viewPath, {
    pageTitle: '${config.name}',
    items: []
  });
});

module.exports = router;
`;
    archive.append(routeContent, { name: 'routes/main.js' });

    // View
    const viewContent = `<% const _v = Array.isArray(settings.views) ? settings.views[0] : settings.views; %>
<%- include(_v + '/partials/head', { pageTitle: pageTitle }) %>

<div class="page-header">
  <h1><%= pageTitle %></h1>
  <a href="/" class="btn btn-outline">Back to Dashboard</a>
</div>

<div class="card">
  <p style="color: var(--text-secondary);">
    Welcome to ${config.name}! Start building your addon here.
  </p>

  <% if (items && items.length > 0) { %>
    <ul>
      <% items.forEach(item => { %>
        <li><%= item.title %></li>
      <% }); %>
    </ul>
  <% } else { %>
    <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
      <p>No items yet.</p>
    </div>
  <% } %>
</div>

<%- include(_v + '/partials/foot') %>
`;
    archive.append(viewContent, { name: 'views/' + addonId + '/index.ejs' });
  }

  // Dashboard widget view
  if (config.includeWidget) {
    const widgetContent = `<div class="page-header">
  <h2>${config.name}</h2>
  <a href="/${addonId}" class="btn btn-secondary">View All</a>
</div>
<% if (items && items.length > 0) { %>
  <ul>
    <% items.forEach(item => { %>
      <li><%= item.title %></li>
    <% }); %>
  </ul>
<% } else { %>
  <p style="color: var(--text-secondary);">Nothing here yet.</p>
<% } %>
`;
    archive.append(widgetContent, { name: 'views/widgets/' + addonId + '-widget.ejs' });
  }

  // CSS
  if (config.includeCss) {
    const cssContent = `/* ${config.name} styles */
/* Use Quest Planner CSS variables for consistent theming:
 * var(--bg-card), var(--bg-surface), var(--text-primary), var(--text-secondary)
 * var(--gold), var(--border), var(--radius), var(--success), var(--error)
 */
`;
    archive.append(cssContent, { name: 'public/css/' + addonId + '.css' });
  }

  // JS
  if (config.includeJs) {
    const jsContent = `/* ${config.name} client-side JavaScript */
document.addEventListener('DOMContentLoaded', function() {
  console.log('${config.name} loaded');
});
`;
    archive.append(jsContent, { name: 'public/js/' + addonId + '.js' });
  }

  archive.finalize();
});

// Validate — check a .qpa file
router.post('/validate', requireAdmin, (req, res) => {
  const multer = require('multer');
  const { execSync } = require('child_process');

  // Handle file upload inline
  const uploadTemp = path.join(__dirname, '..', '..', '..', 'data', 'temp');
  if (!fs.existsSync(uploadTemp)) fs.mkdirSync(uploadTemp, { recursive: true });

  const upload = multer({ dest: uploadTemp, limits: { fileSize: 50 * 1024 * 1024 } }).single('addon_package');

  upload(req, res, function(err) {
    if (err) return res.json({ error: 'Upload failed: ' + err.message });
    if (!req.file) return res.json({ error: 'No file uploaded' });

    const uploadedPath = req.file.path;
    const extractDir = path.join(uploadTemp, 'validate-' + Date.now());
    const results = { checks: [], warnings: [], errors: [] };

    try {
      // Extract
      fs.mkdirSync(extractDir, { recursive: true });
      try {
        execSync(`unzip -o "${uploadedPath}" -d "${extractDir}"`, { timeout: 30000 });
      } catch (e) {
        results.errors.push('Failed to extract archive: not a valid ZIP file');
        cleanup();
        return res.json(results);
      }

      // Check addon.json exists
      const manifestPath = path.join(extractDir, 'addon.json');
      if (!fs.existsSync(manifestPath)) {
        results.checks.push({ name: 'addon.json exists', pass: false });
        results.errors.push('addon.json not found at archive root');
        cleanup();
        return res.json(results);
      }
      results.checks.push({ name: 'addon.json exists', pass: true });

      // Parse addon.json
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (e) {
        results.checks.push({ name: 'addon.json is valid JSON', pass: false });
        results.errors.push('addon.json is not valid JSON: ' + e.message);
        cleanup();
        return res.json(results);
      }
      results.checks.push({ name: 'addon.json is valid JSON', pass: true });

      // Required fields
      const hasId = !!manifest.id;
      const hasName = !!manifest.name;
      const hasVersion = !!manifest.version;
      results.checks.push({ name: 'Has required field: id', pass: hasId });
      results.checks.push({ name: 'Has required field: name', pass: hasName });
      results.checks.push({ name: 'Has required field: version', pass: hasVersion });
      if (!hasId) results.errors.push('Missing required field: id');
      if (!hasName) results.errors.push('Missing required field: name');
      if (!hasVersion) results.errors.push('Missing required field: version');

      // Type check
      const isCommunity = manifest.type === 'community';
      results.checks.push({ name: 'Type is "community"', pass: isCommunity });
      if (!isCommunity) results.warnings.push('Type should be "community" for store addons (got: "' + manifest.type + '")');

      // Optional fields
      if (!manifest.description) results.warnings.push('Missing optional field: description');
      if (!manifest.author) results.warnings.push('Missing optional field: author');
      if (!manifest.category) results.warnings.push('Missing optional field: category');
      if (!manifest.icon) results.warnings.push('Missing optional field: icon');

      // Check route files exist
      if (manifest.routes && Array.isArray(manifest.routes)) {
        for (const route of manifest.routes) {
          if (route.file) {
            const routeFile = path.join(extractDir, route.file);
            const exists = fs.existsSync(routeFile);
            results.checks.push({ name: 'Route file exists: ' + route.file, pass: exists });
            if (!exists) results.errors.push('Declared route file missing: ' + route.file);
          }
        }
      }

      // Check CSS/JS files
      for (const type of ['css', 'js']) {
        if (manifest[type] && Array.isArray(manifest[type])) {
          for (const file of manifest[type]) {
            const filePath = path.join(extractDir, 'public', file);
            const exists = fs.existsSync(filePath);
            results.checks.push({ name: type.toUpperCase() + ' file exists: ' + file, pass: exists });
            if (!exists) results.warnings.push('Declared ' + type + ' file missing: public/' + file);
          }
        }
      }

      // Check migrations
      const migrationsDir = path.join(extractDir, 'migrations');
      if (fs.existsSync(migrationsDir)) {
        const migFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js'));
        results.checks.push({ name: 'Migrations directory found', pass: true, detail: migFiles.length + ' file(s)' });
        for (const mf of migFiles) {
          try {
            const content = fs.readFileSync(path.join(migrationsDir, mf), 'utf-8');
            const hasVersion = content.includes('version:') || content.includes('version :');
            const hasUp = content.includes('up(') || content.includes('up (');
            results.checks.push({
              name: 'Migration ' + mf + ' structure',
              pass: hasVersion && hasUp,
              detail: (!hasVersion ? 'missing version' : '') + (!hasUp ? ' missing up()' : '')
            });
          } catch (e) {
            results.checks.push({ name: 'Migration ' + mf, pass: false, detail: 'Could not read file' });
          }
        }
      }

      // Check hooks.js
      if (fs.existsSync(path.join(extractDir, 'hooks.js'))) {
        results.checks.push({ name: 'hooks.js found', pass: true });
        const hooksContent = fs.readFileSync(path.join(extractDir, 'hooks.js'), 'utf-8');
        if (hooksContent.includes('onUserDelete')) {
          results.checks.push({ name: 'hooks.js has onUserDelete handler', pass: true });
        } else {
          results.warnings.push('hooks.js missing onUserDelete — user data may be orphaned on deletion');
        }
      } else {
        results.warnings.push('No hooks.js found — consider adding lifecycle hooks');
      }

      // Security scan
      const allFiles = getAllFiles(extractDir).filter(f => f.endsWith('.js') || f.endsWith('.ejs'));
      const dangerousPatterns = [
        { pattern: /eval\s*\(/, name: 'eval()' },
        { pattern: /Function\s*\(/, name: 'Function constructor' },
        { pattern: /child_process/, name: 'child_process module' },
        { pattern: /fs\.(writeFileSync|appendFileSync|mkdirSync)\s*\([^)]*(?:\.\.\/|\/etc|\/usr|\/bin)/, name: 'filesystem write outside data/' },
        { pattern: /process\.exit/, name: 'process.exit()' }
      ];

      let securityIssues = 0;
      for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const relPath = path.relative(extractDir, file);
        for (const dp of dangerousPatterns) {
          if (dp.pattern.test(content)) {
            results.errors.push('Security: ' + dp.name + ' found in ' + relPath);
            securityIssues++;
          }
        }
      }
      results.checks.push({ name: 'Security scan', pass: securityIssues === 0, detail: securityIssues === 0 ? 'No dangerous patterns found' : securityIssues + ' issue(s)' });

      // Summary
      results.manifest = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author || 'Unknown',
        category: manifest.category || 'Uncategorized',
        description: manifest.description || ''
      };

    } catch (err) {
      results.errors.push('Validation error: ' + err.message);
    }

    cleanup();
    res.json(results);

    function cleanup() {
      try { fs.unlinkSync(uploadedPath); } catch (e) {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});

// Recursive file list helper
function getAllFiles(dir, files) {
  files = files || [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

module.exports = router;
