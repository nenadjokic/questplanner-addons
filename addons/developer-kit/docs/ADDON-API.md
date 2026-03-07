# Addon API Reference

Technical reference for the Quest Planner addon system internals.

## AddonManager

The `AddonManager` class is instantiated once at server startup and stored at `app.locals.addonManager`. It manages the full addon lifecycle: discovery, loading, mounting, enabling, disabling, and uninstalling.

### Public Methods

#### `isEnabled(addonId: string): boolean`

Returns `true` if the given addon is currently enabled.

```js
const addonManager = req.app.locals.addonManager;
if (addonManager.isEnabled('maps')) {
  // Maps addon is active
}
```

#### `getAll(): AddonInfo[]`

Returns an array of all discovered addons (both enabled and disabled).

Each `AddonInfo` object contains:

```js
{
  id: 'bulletin-board',
  name: 'Bulletin Board',
  version: '1.0.0',
  description: 'Community bulletin board...',
  author: 'Quest Planner',
  category: 'Social',
  icon: 'scroll',
  type: 'preinstalled',   // or 'community'
  enabled: true,
  dir: '/abs/path/to/addon',
  manifest: { /* raw addon.json */ },
  hooks: { /* loaded hooks.js exports */ },
  migrations: [ /* loaded migration objects */ ]
}
```

#### `getNavItems(user: object): NavItem[]`

Returns navigation items for the given user, filtered by role and sorted by group then sort order.

```js
const navItems = addonManager.getNavItems(req.session.user);
// [{ label, href, icon, group, sort, roles, addonId }]
```

#### `getAddonCSS(): string[]`

Returns an array of CSS file URLs for all enabled addons, with cache-busting version parameters.

```js
// ['/addons/my-addon/css/style.css?v=1.0.0']
```

#### `getAddonJS(): string[]`

Returns an array of JS file URLs for all enabled addons.

#### `getDashboardWidgets(user: object, isDM: boolean): Widget[]`

Calls `getDashboardData()` on every enabled addon that declares `dashboardWidgets`, filters by role, and returns sorted widget objects.

Each widget contains:

```js
{
  id: 'active-quests',
  label: 'Active Quests',
  position: 'bottom',
  sort: 20,
  templatePath: '/abs/path/to/views/widgets/active-quests.ejs',
  data: { quests: [...] },
  addonId: 'quest-board'
}
```

#### `enable(addonId: string): void`

Enables an addon. Updates `addon_state` in the database. Call `reload()` afterward to update nav items, CSS, and JS lists.

#### `disable(addonId: string): void`

Disables an addon. Calls the addon's `onDisable` hook if defined. Call `reload()` afterward.

#### `reload(): void`

Recalculates nav items, CSS files, and JS files from all currently enabled addons. Also runs any pending migrations for newly enabled addons. No server restart is required because `addon-guard` checks `isEnabled()` on every request.

#### `deleteData(addonId: string): void`

Runs all `down()` migrations in reverse order, removing the addon's database tables and data. Also clears migration tracking records.

#### `uninstall(addonId: string): void`

Community addons only. Disables the addon, deletes its data, removes its files from disk, and removes its state record. Throws if called on a preinstalled addon.

#### `installFromZip(zipPath: string): Promise<string>`

Extracts a `.qpa` (ZIP) file to `data/addons/<id>/`. Returns the addon ID from the manifest. After calling this, run `discover()`, `loadAll()`, and `reload()` to activate the addon.

#### `handleUserDelete(userId: number): void`

Calls `onUserDelete(ctx, userId)` on every enabled addon that defines the hook. Used by the user deletion flow to clean up all addon-owned data.

#### `getViewPaths(): string[]`

Returns an array of view directory paths for all enabled addons. Used internally for EJS template resolution.

## addon-guard Middleware

Protects routes so they return 404 when their addon is disabled.

```js
const addonGuard = require('../middleware/addon-guard');

// In a route file:
router.use(addonGuard('my-addon'));

// Or on specific routes:
router.get('/my-page', addonGuard('my-addon'), (req, res) => {
  // Only reachable when 'my-addon' is enabled
});
```

The middleware reads `req.app.locals.addonManager` and checks `isEnabled()`. If the addon is disabled, it renders the 404 page with the message "This feature is not currently enabled."

## addonEnabled() Template Helper

Available in all EJS templates. Returns `true` if the given addon is enabled.

```html
<% if (addonEnabled('maps')) { %>
  <a href="/map">Go to Maps</a>
<% } %>
```

Also available in templates:
- `addonCSS` -- array of CSS URLs for enabled addons
- `addonJS` -- array of JS URLs for enabled addons
- `addonNavItems` -- nav items for the current user

## Database Access

The context object provides `ctx.db`, which is a `better-sqlite3` `Database` instance. All operations are synchronous.

### Common Patterns

```js
// Select multiple rows
const rows = ctx.db.prepare('SELECT * FROM my_table WHERE user_id = ?').all(userId);

// Select one row
const row = ctx.db.prepare('SELECT * FROM my_table WHERE id = ?').get(id);

// Insert
const result = ctx.db.prepare(
  'INSERT INTO my_table (user_id, title) VALUES (?, ?)'
).run(userId, title);
// result.lastInsertRowid

// Update
ctx.db.prepare('UPDATE my_table SET title = ? WHERE id = ?').run(newTitle, id);

// Delete
ctx.db.prepare('DELETE FROM my_table WHERE id = ?').run(id);

// Execute DDL (no parameters)
ctx.db.exec('CREATE TABLE IF NOT EXISTS ...');

// Transaction
const insertMany = ctx.db.transaction((items) => {
  const stmt = ctx.db.prepare('INSERT INTO my_table (title) VALUES (?)');
  for (const item of items) stmt.run(item.title);
});
insertMany(items);
```

### Accessing the Database in Routes

In route handlers, access the database via `req.app.locals.db`:

```js
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare('SELECT * FROM my_table').all();
  res.render('my-view', { rows });
});
```

## Available Icon Names

These icon identifiers can be used in `navItems[].icon` and the top-level `icon` field in `addon.json`:

| Icon | Used By |
|------|---------|
| `scroll` | Bulletin Board |
| `book` | Campaigns |
| `globe` | Maps |
| `chest` | Loot Tracker |
| `journal` | Quest Journal |
| `quest` | Quest Board |
| `image` | Handouts |
| `sword` | Encounter Builder |
| `sparkle` | Generators |
| `chart` | Analytics |
| `megaphone` | Announcements |
| `music` | Sound Board |
| `dice` | Dice Roller |
| `send` | Messenger |
| `key` | Google Auth |
| `shield` | Backup |
| `bell` | Auto Reminders |
| `puzzle` | Default / generic |

## Soft Dependencies

Use `softDependencies` when your addon can optionally integrate with another addon but does not require it:

```json
{
  "softDependencies": ["maps", "loot-tracker"]
}
```

At runtime, check if the dependency is available:

```js
onLoad(ctx) {
  if (ctx.addonManager.isEnabled('maps')) {
    // Register map integration features
  }
}
```

```html
<% if (addonEnabled('maps')) { %>
  <a href="/map">Show on Map</a>
<% } %>
```

Soft dependencies are informational -- the addon loads and works regardless of whether the dependency is enabled. Hard `dependencies` (not yet enforced at runtime) are for documentation purposes and future validation.

## Addon Lifecycle

1. **Server startup:** `AddonManager` is created with the database and Express app.
2. **Discovery:** `discover()` scans `addons/` (preinstalled) and `data/addons/` (community) for directories with `addon.json`.
3. **Loading:** `loadAll()` loads `hooks.js` and migration files, checks `addon_state` table, auto-enables new preinstalled addons, and runs pending migrations.
4. **Mounting:** `mountAll()` calls `onLoad()`, mounts routes, registers static asset paths, collects nav items, CSS, and JS.
5. **Runtime:** `addon-guard` middleware checks `isEnabled()` per request. `addonEnabled()` helper available in templates.
6. **Enable/Disable:** Admin panel calls `enable()`/`disable()` then `reload()`. No server restart needed.
7. **Uninstall:** `uninstall()` disables, runs down migrations, deletes files (community only).

## Database Tables (System)

The addon manager creates two system tables:

```sql
addon_state (
  addon_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  version TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'preinstalled'
    CHECK(type IN ('preinstalled', 'community'))
)

addon_migrations (
  addon_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(addon_id, version)
)
```
