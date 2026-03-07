# Addon Submission Guide

How to submit a community addon to the Quest Planner addon registry.

## Prerequisites

Before submitting, ensure your addon:

1. Has a valid `addon.json` with all required fields (`id`, `name`, `version`).
2. Uses `"type": "community"` in `addon.json`.
3. Works with the minimum Quest Planner version specified in `minAppVersion`.
4. Has been tested by installing via the Admin > Addons > Upload flow.
5. Includes `down()` migrations so users can cleanly remove addon data.

## Submission Process

### 1. Fork the Registry Repository

Fork [questplanner-addons](https://github.com/questplanner/questplanner-addons) on GitHub.

### 2. Build Your .qpa Package

Package your addon as a ZIP file renamed to `.qpa`. The `addon.json` must be at the root of the archive, not nested in a subdirectory.

```bash
cd my-addon/
zip -r ../my-addon-1.0.0.qpa . -x "*.DS_Store" -x "__MACOSX/*" -x ".git/*"
```

### 3. Add Your Addon to the Registry

Place your `.qpa` file in the `packages/` directory of the forked repo.

Add an entry to `registry.json`:

```json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Short description of what the addon does.",
  "category": "Gameplay",
  "minAppVersion": "3.0.0",
  "package": "packages/my-addon-1.0.0.qpa",
  "repository": "https://github.com/yourname/my-addon"
}
```

### 4. Submit a Pull Request

Open a PR against the main branch of `questplanner-addons` with:

- The `.qpa` file in `packages/`
- The updated `registry.json` entry
- A brief description of what the addon does in the PR body

## Review Criteria

Submitted addons are reviewed for the following:

### Required

- **Valid manifest:** `addon.json` contains `id`, `name`, `version`, and `type: "community"`.
- **Working migrations:** All `up()` migrations execute without errors on a clean database. `down()` migrations are present and functional.
- **No malicious code:** No file system operations outside `data/`, no network requests to unknown hosts, no modification of core app files.
- **No dependency conflicts:** Table names must not collide with core tables or other addons. Prefix your tables with your addon ID if in doubt (e.g. `mynotes_entries` instead of `entries`).

### Recommended

- **Idempotent migrations:** Use `CREATE TABLE IF NOT EXISTS` and wrap `ALTER TABLE` in try/catch.
- **User cleanup:** Implement `onUserDelete` hook to remove user-owned data when a user is deleted.
- **Role-based access:** Use `roles` on nav items and dashboard widgets to restrict visibility appropriately.
- **Consistent styling:** Use Quest Planner's CSS custom properties (`var(--bg-card)`, `var(--text-primary)`, `var(--accent)`, etc.) rather than hardcoded colors.

## Version Requirements

- Follow semantic versioning: `MAJOR.MINOR.PATCH`.
- When updating an existing addon, increment the version and add a new `.qpa` file. Do not overwrite the old package.
- Update your `registry.json` entry to point to the new package file.
- Each migration must have a unique, incrementing `version` number. Never change an already-published migration -- add a new one instead.

## Updating a Published Addon

1. Increment `version` in `addon.json`.
2. Add new migration files if the schema changed (do not modify existing migrations).
3. Build a new `.qpa` package with the new version number in the filename.
4. Update `registry.json` with the new version and package path.
5. Submit a new PR.

## Testing Checklist

Before submitting, verify:

- [ ] Fresh install works: upload `.qpa` via Admin > Addons, addon appears and is enabled.
- [ ] Addon pages load without errors.
- [ ] Dashboard widget renders correctly (if applicable).
- [ ] Navigation item appears in the correct menu group (if applicable).
- [ ] Disabling the addon via Admin > Addons makes its routes return 404.
- [ ] Re-enabling the addon restores full functionality without data loss.
- [ ] Deleting addon data (Admin > Addons > Delete Data) removes all tables cleanly.
- [ ] Uninstalling removes files from `data/addons/`.
- [ ] Deleting a user does not leave orphaned rows in your tables.
