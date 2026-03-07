# Creating Quest Planner Addons

This guide walks through building a Quest Planner addon from scratch.

## Directory Structure

```
my-addon/
  addon.json          # Required. Manifest file.
  hooks.js            # Optional. Lifecycle hooks.
  migrations/         # Optional. Database migrations.
    001-initial.js
  views/              # Optional. EJS templates.
    widgets/          # Dashboard widget templates.
  public/             # Optional. Static assets (CSS, JS, images).
  routes/             # Optional. Express routers (community addons).
```

## addon.json Manifest

Every addon requires an `addon.json` in its root directory. Three fields are mandatory: `id`, `name`, and `version`.

```json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "icon": "puzzle",
  "category": "Gameplay",
  "description": "A short description of what this addon does.",
  "author": "Your Name",
  "type": "community",
  "minAppVersion": "3.0.0",
  "routes": [],
  "navItems": [],
  "css": [],
  "js": [],
  "dashboardWidgets": [],
  "dependencies": [],
  "softDependencies": []
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier. Use lowercase with hyphens (e.g. `my-addon`). |
| `name` | string | Yes | Human-readable display name. |
| `version` | string | Yes | Semantic version (e.g. `1.0.0`). |
| `icon` | string | No | Icon identifier for the admin panel. See ADDON-API.md for available names. Defaults to `puzzle`. |
| `category` | string | No | Grouping label in the addon manager (e.g. `Gameplay`, `Social`, `DM Tools`). |
| `description` | string | No | One-line description shown in the addon manager. |
| `author` | string | No | Author name. Defaults to `Unknown`. |
| `type` | string | No | `preinstalled` (ships with app) or `community` (installed via .qpa). |
| `minAppVersion` | string | No | Minimum Quest Planner version required. |
| `routes` | string or array | No | Route mount path (string like `"/board"`) or array of `{path, file}` objects. See Routes below. |
| `navItems` | array | No | Navigation menu entries. See Nav Items below. |
| `css` | array | No | CSS file paths relative to `public/`. |
| `js` | array | No | JS file paths relative to `public/`. |
| `dashboardWidgets` | array | No | Dashboard widget definitions. See Dashboard Widgets below. |
| `dependencies` | array | No | Required addon IDs. Addon will not load without these. |
| `softDependencies` | array | No | Optional addon IDs. Addon works without them but can use them if present. |
| `tables` | array | No | Informational list of database tables this addon manages. |
| `uploadDirs` | array | No | Subdirectories under `data/uploads/` to serve as static files. |

## Routes

For **preinstalled addons**, routes are typically a string path (e.g. `"/board"`). The actual Express router lives in the main app's `routes/` directory and uses `addon-guard` middleware to check if the addon is enabled.

For **community addons**, routes can be an array of `{path, file}` objects. If omitted, the system auto-detects `routes/main.js` and mounts it at `/<addon-id>`:

```json
"routes": [
  { "path": "/my-addon", "file": "routes/main.js" }
]
```

The route file should export an Express Router:

```js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('my-addon/index', { title: 'My Addon' });
});

module.exports = router;
```

## Nav Items

Add entries to the app's navigation menu:

```json
"navItems": [
  {
    "label": "My Addon",
    "href": "/my-addon",
    "icon": "puzzle",
    "group": "tools",
    "sort": 50,
    "roles": ["admin", "dm", "player"]
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Menu text. |
| `href` | string | URL path. |
| `icon` | string | Icon identifier. See ADDON-API.md for the full list. |
| `group` | string | Menu section: `main`, `tools`, `dmzone`, or `admin`. |
| `sort` | number | Sort order within the group. Lower numbers appear first. |
| `roles` | array | Which roles can see this item: `admin`, `dm`, `player`. Omit for all roles. |

## hooks.js

The hooks file exports an object with lifecycle methods. All hooks receive a context object `ctx` as their first argument.

```js
'use strict';

module.exports = {
  /**
   * Called when the addon is mounted during server startup.
   */
  onLoad(ctx) {
    // Initialize resources, register event listeners, etc.
  },

  /**
   * Called when the addon is disabled via the admin panel.
   */
  onDisable(ctx) {
    // Clean up resources if needed.
  },

  /**
   * Called when a user is deleted. Clean up all user-owned data.
   */
  onUserDelete(ctx, userId) {
    ctx.db.prepare('DELETE FROM my_table WHERE user_id = ?').run(userId);
  },

  /**
   * Return data for dashboard widgets. Keys must match widget IDs.
   */
  getDashboardData(ctx, user, isDM) {
    const items = ctx.db.prepare(
      'SELECT * FROM my_table WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
    ).all(user.id);

    return {
      'my-widget': { items }
    };
  }
};
```

### Context Object (ctx)

| Property | Type | Description |
|----------|------|-------------|
| `ctx.db` | Database | `better-sqlite3` database instance. Synchronous API. |
| `ctx.app` | Express | The Express application instance. |
| `ctx.addonDir` | string | Absolute path to this addon's directory. |
| `ctx.dataDir` | string | Absolute path to the app's `data/` directory. |
| `ctx.sse` | object | Server-Sent Events helper for real-time updates. |
| `ctx.notifications` | object | Notification system helper. |
| `ctx.addonManager` | AddonManager | The addon manager instance. Use to check other addon states. |

## Migrations

Place migration files in `migrations/` with numeric prefixes for sort order. Each file exports an object:

```js
// migrations/001-initial.js
'use strict';

module.exports = {
  version: 1,
  description: 'Create my_table',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS my_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS my_table');
  }
};
```

Rules:
- `version` must be a unique integer per addon, incrementing with each new migration.
- `up(db)` receives a `better-sqlite3` database instance. Use `db.exec()` for DDL, `db.prepare().run()` for DML.
- `down(db)` should reverse the migration. Used when deleting addon data.
- Migrations run automatically when an addon is enabled. Already-applied migrations are tracked in `addon_migrations` and skipped.
- Use `CREATE TABLE IF NOT EXISTS` and `try/catch` around `ALTER TABLE` to make migrations idempotent.

Adding a column in a later migration:

```js
// migrations/002-add-status.js
module.exports = {
  version: 2,
  description: 'Add status column to my_table',

  up(db) {
    try {
      db.exec("ALTER TABLE my_table ADD COLUMN status TEXT DEFAULT 'active'");
    } catch (e) {
      // Column already exists
    }
  },

  down(db) {
    // SQLite cannot drop columns directly; leave as-is or recreate table
  }
};
```

## Dashboard Widgets

To display a widget on the dashboard:

1. Declare it in `addon.json`:

```json
"dashboardWidgets": [
  {
    "id": "my-widget",
    "label": "My Widget",
    "position": "bottom",
    "sort": 40,
    "template": "widgets/my-widget.ejs",
    "roles": ["admin", "dm", "player"]
  }
]
```

2. Create the template at `views/widgets/my-widget.ejs`:

```html
<div class="page-header">
  <h2>My Widget</h2>
  <a href="/my-addon" class="btn btn-secondary">View All</a>
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
```

3. Return the widget data from `getDashboardData()` in hooks.js. The return object key must match the widget `id`:

```js
getDashboardData(ctx, user, isDM) {
  const items = ctx.db.prepare('SELECT * FROM my_table LIMIT 5').all();
  return { 'my-widget': { items } };
}
```

Widget properties:
- `position`: `"top"`, `"middle"`, or `"bottom"` on the dashboard.
- `sort`: Order within the position group. Lower = higher.
- `roles`: Which roles see this widget.

## CSS and JS Inclusion

Place files in your addon's `public/` directory and reference them in `addon.json`:

```json
"css": ["css/my-addon.css"],
"js": ["js/my-addon.js"]
```

These are served at `/addons/<addon-id>/css/my-addon.css` and automatically included in every page's `<head>` (CSS) and before `</body>` (JS) with a cache-busting version parameter.

## Packaging as .qpa

A `.qpa` file is just a ZIP archive with a different extension. The ZIP must contain `addon.json` at the root level (not nested in a subdirectory).

```bash
cd my-addon/
zip -r ../my-addon-1.0.0.qpa . -x "*.DS_Store" -x "__MACOSX/*"
```

Structure inside the ZIP:

```
addon.json
hooks.js
migrations/001-initial.js
views/widgets/my-widget.ejs
public/css/my-addon.css
```

Users install `.qpa` files via Admin > Addons > Upload. The addon is extracted to `data/addons/<addon-id>/`, auto-enabled, and migrations run immediately.

## Complete Example: Party Notes Addon

A minimal addon that lets players create shared notes.

### addon.json

```json
{
  "id": "party-notes",
  "name": "Party Notes",
  "version": "1.0.0",
  "icon": "journal",
  "category": "Social",
  "description": "Shared note-taking for the party.",
  "author": "Your Name",
  "type": "community",
  "routes": [
    { "path": "/notes", "file": "routes/main.js" }
  ],
  "navItems": [
    {
      "label": "Party Notes",
      "href": "/notes",
      "icon": "journal",
      "group": "main",
      "sort": 50,
      "roles": ["admin", "dm", "player"]
    }
  ],
  "dashboardWidgets": [
    {
      "id": "recent-notes",
      "label": "Recent Notes",
      "position": "bottom",
      "sort": 60,
      "template": "widgets/recent-notes.ejs",
      "roles": ["admin", "dm", "player"]
    }
  ]
}
```

### migrations/001-initial.js

```js
'use strict';

module.exports = {
  version: 1,
  description: 'Create party_notes table',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS party_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS party_notes');
  }
};
```

### hooks.js

```js
'use strict';

module.exports = {
  onUserDelete(ctx, userId) {
    ctx.db.prepare('DELETE FROM party_notes WHERE user_id = ?').run(userId);
  },

  getDashboardData(ctx, user, isDM) {
    const notes = ctx.db.prepare(
      'SELECT n.*, u.username FROM party_notes n JOIN users u ON u.id = n.user_id ORDER BY n.created_at DESC LIMIT 5'
    ).all();
    return { 'recent-notes': { notes } };
  }
};
```

### routes/main.js

```js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const notes = req.app.locals.db.prepare(
    'SELECT n.*, u.username FROM party_notes n JOIN users u ON u.id = n.user_id ORDER BY n.created_at DESC'
  ).all();
  res.render('party-notes/index', { title: 'Party Notes', notes });
});

router.post('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  req.app.locals.db.prepare(
    'INSERT INTO party_notes (user_id, title, content) VALUES (?, ?, ?)'
  ).run(req.session.userId, req.body.title, req.body.content);
  res.redirect('/notes');
});

module.exports = router;
```

### views/widgets/recent-notes.ejs

```html
<div class="page-header">
  <h2>Recent Notes</h2>
  <a href="/notes" class="btn btn-secondary">View All</a>
</div>
<% if (notes && notes.length > 0) { %>
  <% notes.forEach(n => { %>
    <p><strong><%= n.title %></strong> by <%= n.username %></p>
  <% }); %>
<% } else { %>
  <p style="color: var(--text-secondary);">No notes yet.</p>
<% } %>
```

### Package it

```bash
cd party-notes/
zip -r ../party-notes-1.0.0.qpa . -x "*.DS_Store"
```

Upload the `.qpa` file via Admin > Addons > Upload to install.
