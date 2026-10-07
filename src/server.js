require('dotenv').config();
const app = require('./app');
const db = require('./config/db');
const cache = require('./config/cache');

const port = process.env.PORT || 3000;
cache.connect();

const server = app.listen(port, () => {
  console.log(`InventoryPro API listening on :${port}  (docs: /api-docs)`);
});

async function shutdown() {
  server.close(async () => {
    await cache.disconnect();
    await db.pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
