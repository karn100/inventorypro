const request = require('supertest');
const cache = require('../src/config/cache');
const { app, db, resetDb, createAdmin, createProduct, bearer } = require('./helpers');

let admin;
beforeAll(async () => {
  await resetDb();
  admin = await createAdmin();
  cache.connect();
});
afterAll(async () => { await cache.disconnect(); await db.pool.end(); });

describe('Products CRUD & stock levels', () => {
  let product;

  it('creates a product and rejects duplicate SKU', async () => {
    product = await createProduct(admin, { sku: 'P-001', name: 'Laptop Stand', price: 29.99, stockQuantity: 15 });
    expect(product).toMatchObject({ sku: 'P-001', price: 29.99, stockQuantity: 15 });
    const dup = await request(app).post('/api/products').set(bearer(admin)).send({ sku: 'P-001', name: 'X', price: 1 });
    expect(dup.status).toBe(409);
  });

  it('validates input (negative price)', async () => {
    const res = await request(app).post('/api/products').set(bearer(admin)).send({ sku: 'BAD', name: 'Bad', price: -1 });
    expect(res.status).toBe(400);
  });

  it('gets a product by id; 404 for unknown; 400 for bad id', async () => {
    expect((await request(app).get(`/api/products/${product.id}`)).body.name).toBe('Laptop Stand');
    expect((await request(app).get('/api/products/99999')).status).toBe(404);
    expect((await request(app).get('/api/products/abc')).status).toBe(400);
  });

  it('lists with pagination, search and sorting', async () => {
    await createProduct(admin, { sku: 'P-002', name: 'Desk Lamp', price: 15 });
    const res = await request(app).get('/api/products?search=lamp&sortBy=price&order=asc');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 1 });
  });

  it('updates a product', async () => {
    const res = await request(app).put(`/api/products/${product.id}`).set(bearer(admin)).send({ price: 34.5 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(34.5);
  });

  it('adjusts and sets stock levels, never going negative', async () => {
    const dec = await request(app).patch(`/api/products/${product.id}/stock`).set(bearer(admin)).send({ change: -5 });
    expect(dec.body.stockQuantity).toBe(10);
    const set = await request(app).patch(`/api/products/${product.id}/stock`).set(bearer(admin)).send({ quantity: 100 });
    expect(set.body.stockQuantity).toBe(100);
    const neg = await request(app).patch(`/api/products/${product.id}/stock`).set(bearer(admin)).send({ change: -500 });
    expect(neg.status).toBe(400);
    const both = await request(app).patch(`/api/products/${product.id}/stock`).set(bearer(admin)).send({ change: 1, quantity: 1 });
    expect(both.status).toBe(400);
  });

  it('reports low-stock products', async () => {
    await createProduct(admin, { sku: 'P-LOW', name: 'Almost Gone', stockQuantity: 2 });
    const res = await request(app).get('/api/products/low-stock?threshold=5').set(bearer(admin));
    expect(res.body.data.map((p) => p.sku)).toEqual(['P-LOW']);
  });

  it('deletes a product', async () => {
    expect((await request(app).delete(`/api/products/${product.id}`).set(bearer(admin))).status).toBe(204);
    expect((await request(app).delete(`/api/products/${product.id}`).set(bearer(admin))).status).toBe(404);
  });
});

// Runs only when REDIS_URL is configured (CI / docker compose)
const redisIt = process.env.REDIS_URL ? it : it.skip;
describe('Redis caching', () => {
  redisIt('serves repeated catalog reads from cache and invalidates on writes', async () => {
    await new Promise((r) => setTimeout(r, 500)); // allow Redis connection
    await request(app).get('/api/products?limit=7'); // prime
    const hit = await request(app).get('/api/products?limit=7');
    expect(hit.headers['x-cache']).toBe('HIT');

    await createProduct(admin, { sku: 'CACHE-1', name: 'Invalidator' });
    const afterWrite = await request(app).get('/api/products?limit=7');
    expect(afterWrite.headers['x-cache']).toBe('MISS');
  });
});
