/**
 * GitHub raw content fetcher for 5e.tools mirror data
 */

const BASE_URL = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main';

/**
 * Fetch JSON from GitHub raw content
 */
async function fetchJSON(path) {
  const url = `${BASE_URL}/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub fetch failed: ${response.status} for ${path}`);
  return response.json();
}

/**
 * Fetch the master adventure index
 * Returns array of adventure metadata
 */
async function fetchAdventureIndex() {
  const data = await fetchJSON('data/adventures.json');
  return (data.adventure || []).map(adv => ({
    id: adv.id,
    name: adv.name,
    source: adv.source,
    group: adv.group || '',
    published: adv.published || '',
    author: adv.author || 'Wizards of the Coast',
    storyline: adv.storyline || '',
    level: adv.level || null,
    coverUrl: adv.cover && adv.cover.type === 'internal'
      ? `${BASE_URL}/img/${adv.cover.path}`
      : null,
    contents: adv.contents || []
  }));
}

/**
 * Fetch full adventure data by adventure ID
 * e.g. fetchAdventure('cm') -> fetches data/adventure/adventure-cm.json
 */
async function fetchAdventure(adventureId) {
  const id = adventureId.toLowerCase();
  return fetchJSON(`data/adventure/adventure-${id}.json`);
}

/**
 * Fetch bestiary data for a specific source
 * e.g. fetchBestiary('cm') -> fetches data/bestiary/bestiary-cm.json
 */
async function fetchBestiary(sourceId) {
  const id = sourceId.toLowerCase();
  try {
    return await fetchJSON(`data/bestiary/bestiary-${id}.json`);
  } catch (e) {
    // Some adventures don't have their own bestiary file
    return { monster: [] };
  }
}

/**
 * Fetch the core Monster Manual bestiary for common creatures
 */
async function fetchCoreBestiary() {
  return fetchJSON('data/bestiary/bestiary-mm.json');
}

/**
 * Download an image from GitHub
 * Images are in a separate repo: 5etools-mirror-3/5etools-img
 * Returns Buffer
 */
const IMG_BASE_URL = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main';

async function fetchImage(imagePath) {
  const url = `${IMG_BASE_URL}/${imagePath}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status} for ${imagePath}`);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  BASE_URL,
  fetchJSON,
  fetchAdventureIndex,
  fetchAdventure,
  fetchBestiary,
  fetchCoreBestiary,
  fetchImage
};
