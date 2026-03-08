#!/bin/bash
# Quest Planner Addon Store — Build & Package Script
#
# Usage:
#   ./build.sh                  # Build all addons
#   ./build.sh developer-kit    # Build specific addon
#   ./build.sh --publish        # Build all + commit + push to GitHub
#
set -e

STORE_DIR="$(cd "$(dirname "$0")" && pwd)"
ADDONS_DIR="$STORE_DIR/addons"
PACKAGES_DIR="$STORE_DIR/packages"
REGISTRY="$STORE_DIR/registry.json"

mkdir -p "$PACKAGES_DIR"

# Parse args
SPECIFIC_ADDON=""
PUBLISH=false
for arg in "$@"; do
  case $arg in
    --publish) PUBLISH=true ;;
    *) SPECIFIC_ADDON="$arg" ;;
  esac
done

build_addon() {
  local addon_dir="$1"
  local addon_id=$(basename "$addon_dir")
  local manifest="$addon_dir/addon.json"

  if [ ! -f "$manifest" ]; then
    echo "  Skipping $addon_id — no addon.json"
    return
  fi

  # Read version from manifest
  local version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$manifest','utf8')).version)")
  local pkg_name="${addon_id}-${version}.qpa"

  echo "  Building $addon_id v$version..."

  # Package as .qpa (zip)
  cd "$addon_dir"
  zip -r "$PACKAGES_DIR/$pkg_name" . -x "*.DS_Store" -x "__MACOSX/*" -x ".git/*" > /dev/null
  cd "$STORE_DIR"

  echo "  -> packages/$pkg_name"
}

echo "Quest Planner Addon Store Builder"
echo "================================="
echo ""

if [ -n "$SPECIFIC_ADDON" ]; then
  # Build specific addon
  addon_dir="$ADDONS_DIR/$SPECIFIC_ADDON"
  if [ ! -d "$addon_dir" ]; then
    echo "Error: Addon '$SPECIFIC_ADDON' not found in addons/"
    exit 1
  fi
  build_addon "$addon_dir"
else
  # Build all addons
  for addon_dir in "$ADDONS_DIR"/*/; do
    [ -d "$addon_dir" ] || continue
    build_addon "$addon_dir"
  done
fi

# Rebuild registry.json from all addon manifests
echo ""
echo "Rebuilding registry.json..."

node -e "
const fs = require('fs');
const path = require('path');
const addonsDir = '$ADDONS_DIR';
const packagesDir = '$PACKAGES_DIR';
const addons = [];

for (const dir of fs.readdirSync(addonsDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifestPath = path.join(addonsDir, dir.name, 'addon.json');
  if (!fs.existsSync(manifestPath)) continue;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkgName = m.id + '-' + m.version + '.qpa';
  const entry = {
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author || 'Quest Planner',
    description: m.description || '',
    category: m.category || 'Uncategorized',
    icon: m.icon || 'puzzle',
    type: 'community',
    minAppVersion: m.minAppVersion || '3.0.0',
    downloadUrl: 'https://github.com/nenadjokic/questplanner-addons/raw/main/packages/' + pkgName,
    repository: 'https://github.com/nenadjokic/questplanner-addons'
  };
  if (m.dependencies && typeof m.dependencies === 'object' && !Array.isArray(m.dependencies) && Object.keys(m.dependencies).length > 0) {
    entry.dependencies = m.dependencies;
  }
  if (m.softDependencies && typeof m.softDependencies === 'object' && Object.keys(m.softDependencies).length > 0) {
    entry.softDependencies = m.softDependencies;
  }
  addons.push(entry);
}

const registry = {
  name: 'Quest Planner Official Addon Registry',
  version: '1.0.0',
  updated: new Date().toISOString().split('T')[0],
  addons: addons
};

fs.writeFileSync('$REGISTRY', JSON.stringify(registry, null, 2) + '\n');
console.log('  ' + addons.length + ' addon(s) in registry');
"

if $PUBLISH; then
  echo ""
  echo "Publishing to GitHub..."
  cd "$STORE_DIR"
  git add -A
  git commit -m "Update addon packages — $(date +%Y-%m-%d)" || echo "  No changes to commit"
  git push origin main
  echo "  Published!"
fi

echo ""
echo "Done!"
