/**
 * 5e.tools format parser
 * Parses {@creature Name|Source}, {@spell Name}, {@item Name|Source} tags
 * and converts adventure JSON entries into plain text.
 */

/**
 * Extract all creature references from text
 * Format: {@creature Name|Source|DisplayText}
 * Returns array of { name, source, display }
 */
function extractCreatures(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /\{@creature\s+([^}|]+?)(?:\|([^}|]*?))?(?:\|([^}]*?))?\}/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      name: match[1].trim(),
      source: (match[2] || '').trim(),
      display: (match[3] || match[1]).trim()
    });
  }
  return results;
}

/**
 * Extract all spell references
 */
function extractSpells(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /\{@spell\s+([^}|]+?)(?:\|([^}]*?))?\}/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ name: match[1].trim(), source: (match[2] || '').trim() });
  }
  return results;
}

/**
 * Extract all item references
 */
function extractItems(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /\{@item\s+([^}|]+?)(?:\|([^}]*?))?\}/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ name: match[1].trim(), source: (match[2] || '').trim() });
  }
  return results;
}

/**
 * Strip all 5e.tools tags from text, keeping display text
 * {@tag content|source|display} -> display or content
 */
function stripTags(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/\{@\w+\s+([^}|]+?)(?:\|[^}|]*?)?(?:\|([^}]*?))?\}/g, (_, content, display) => display || content)
    .replace(/\{@\w+\s+([^}]+?)\}/g, '$1');
}

/**
 * Convert a 5e.tools entry (which can be string, object, or array) into plain text
 */
function entryToText(entry, depth) {
  depth = depth || 0;
  if (!entry) return '';
  if (typeof entry === 'string') return stripTags(entry);
  if (Array.isArray(entry)) return entry.map(function(e) { return entryToText(e, depth); }).join('\n');

  if (entry.type === 'entries' || entry.type === 'section') {
    var parts = [];
    if (entry.name) parts.push(entry.name);
    if (entry.entries) parts.push(entryToText(entry.entries, depth + 1));
    return parts.join('\n');
  }

  if (entry.type === 'list') {
    if (entry.items) {
      return entry.items.map(function(item) {
        return '- ' + entryToText(item, depth + 1);
      }).join('\n');
    }
  }

  if (entry.type === 'table') {
    var rows = [];
    if (entry.caption) rows.push(entry.caption);
    if (entry.rows) {
      entry.rows.forEach(function(row) {
        if (Array.isArray(row)) {
          rows.push(row.map(function(cell) { return entryToText(cell, depth + 1); }).join(' | '));
        }
      });
    }
    return rows.join('\n');
  }

  if (entry.type === 'inset' || entry.type === 'insetReadaloud') {
    var parts = [];
    if (entry.name) parts.push('> ' + entry.name);
    if (entry.entries) parts.push(entryToText(entry.entries, depth + 1));
    return parts.join('\n');
  }

  if (entry.type === 'gallery' || entry.type === 'image') {
    return ''; // Skip images in text conversion
  }

  // Fallback: try entries or just stringify
  if (entry.entries) return entryToText(entry.entries, depth + 1);
  if (entry.entry) return entryToText(entry.entry, depth + 1);
  if (typeof entry === 'object' && entry.type) return ''; // unknown type
  return '';
}

/**
 * Extract map images from adventure data
 * Returns array of { path, title, grid, isPlayerVersion }
 */
function extractMaps(entries) {
  var maps = [];

  function walk(entry) {
    if (!entry) return;
    if (Array.isArray(entry)) { entry.forEach(walk); return; }
    if (typeof entry !== 'object') return;

    if (entry.type === 'image' && entry.imageType === 'map') {
      var href = entry.href;
      if (href && href.type === 'internal' && href.path) {
        maps.push({
          path: href.path,
          title: entry.title || '',
          grid: entry.grid || null,
          isPlayerVersion: false
        });
      }
      // Check for player map version
      if (entry.mapRegions) {
        // Has map regions — this is a DM map
      }
    }

    if (entry.type === 'gallery' && entry.images) {
      entry.images.forEach(walk);
    }

    // Recurse into entries
    if (entry.entries) walk(entry.entries);
    if (entry.entry) walk(entry.entry);
  }

  walk(entries);
  return maps;
}

/**
 * Extract all unique creatures referenced in an adventure
 * Walks the full adventure data recursively
 */
function extractAllCreatures(data) {
  var creatures = new Map();

  function walkText(text) {
    extractCreatures(text).forEach(function(c) {
      var key = c.name.toLowerCase() + '|' + c.source.toLowerCase();
      if (!creatures.has(key)) {
        creatures.set(key, c);
      }
    });
  }

  function walk(entry) {
    if (!entry) return;
    if (typeof entry === 'string') { walkText(entry); return; }
    if (Array.isArray(entry)) { entry.forEach(walk); return; }
    if (typeof entry !== 'object') return;

    // Walk all string values
    for (var k in entry) {
      walk(entry[k]);
    }
  }

  walk(data);
  return Array.from(creatures.values());
}

/**
 * Build a chapter structure from adventure data
 * Returns array of { name, level }
 */
function extractChapters(adventureData) {
  if (!adventureData || !adventureData.data) return [];

  return adventureData.data.map(function(section) {
    var chapter = {
      name: section.name || 'Untitled',
      level: null
    };

    // Try to extract level info from first few entries (e.g. "An Adventure for 3rd-level Characters")
    if (section.entries) {
      for (var i = 0; i < Math.min(section.entries.length, 4); i++) {
        var e = section.entries[i];
        if (typeof e === 'object' && e.type === 'list' && e.items) {
          for (var j = 0; j < e.items.length; j++) {
            var item = typeof e.items[j] === 'string' ? e.items[j] : entryToText(e.items[j]);
            var levelMatch = item.match(/Adventure for (\d+\w*)-level/i);
            if (levelMatch) {
              chapter.level = 'Level ' + levelMatch[1];
              break;
            }
          }
          if (chapter.level) break;
        }
      }
    }

    return chapter;
  });
}

module.exports = {
  extractCreatures,
  extractSpells,
  extractItems,
  stripTags,
  entryToText,
  extractMaps,
  extractAllCreatures,
  extractChapters
};
