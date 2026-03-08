/**
 * GitHub raw content fetcher for 5e.tools mirror data
 */

const https = require('https');

const BASE_URL = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main';

/**
 * Simple HTTPS GET that returns a Buffer — works on all Node versions
 */
function httpsGet(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpsGet(resp.headers.location, timeout).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) {
        resp.resume();
        return reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
      }
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Fetch JSON from GitHub raw content
 */
async function fetchJSON(path) {
  const url = `${BASE_URL}/${path}`;
  const buf = await httpsGet(url);
  return JSON.parse(buf.toString('utf8'));
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
  return httpsGet(url, 60000);
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
