const { createClient } = require('redis');

// Redis cache with graceful degradation: if Redis is down, requests hit PostgreSQL.
const TTL = Number(process.env.CACHE_TTL_SECONDS) || 60;
let client = null;
let ready = false;

function connect() {
  if (!process.env.REDIS_URL || client) return;
  client = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 3000) },
  });
  client.on('ready', () => { ready = true; });
  client.on('end', () => { ready = false; });
  client.on('error', () => { ready = false; });
  client.connect().catch(() => {});
}

const isReady = () => ready;

async function version() {
  return (await client.get('products:version')) || '0';
}

async function getJSON(key) {
  if (!ready) return null;
  try {
    const raw = await client.get(`products:v${await version()}:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function setJSON(key, value) {
  if (!ready) return;
  try {
    await client.set(`products:v${await version()}:${key}`, JSON.stringify(value), { EX: TTL });
  } catch { /* ignore */ }
}

// Bumping the version invalidates every cached product entry at once.
async function invalidateProducts() {
  if (!ready) return;
  try { await client.incr('products:version'); } catch { /* ignore */ }
}

async function disconnect() {
  if (client) {
    try { await client.quit(); } catch { /* ignore */ }
    client = null;
    ready = false;
  }
}

module.exports = { connect, isReady, getJSON, setJSON, invalidateProducts, disconnect };
