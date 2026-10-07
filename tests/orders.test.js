const request = require('supertest');
const { app, db, resetDb, createAdmin, createCustomer, createProduct, bearer } = require('./helpers');

let admin, alice, bob, product;
beforeAll(async () => {
  await resetDb();
  admin = await createAdmin();
  alice = await createCustomer('alice@test.com');
  bob = await createCustomer('bob@test.com');
});
beforeEach(async () => {
  product = await createProduct(admin, { price: 12.5, stockQuantity: 10 });
});
afterAll(() => db.pool.end());

const stockOf = async (id) => (await request(app).get(`/api/products/${id}`)).body.stockQuantity;
const place = (token, items) => request(app).post('/api/orders').set(bearer(token)).send({ items });

describe('Orders', () => {
  it('places an order, computes the total and decrements stock', async () => {
    const res = await place(alice.token, [{ productId: product.id, quantity: 3 }]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', totalAmount: 37.5, userId: alice.id });
    expect(res.body.items[0]).toMatchObject({ productId: product.id, quantity: 3, unitPrice: 12.5 });
    expect(await stockOf(product.id)).toBe(7);
  });

  it('rejects orders exceeding stock and leaves stock untouched (rollback)', async () => {
    const res = await place(alice.token, [{ productId: product.id, quantity: 11 }]);
    expect(res.status).toBe(409);
    expect(await stockOf(product.id)).toBe(10);
  });

  it('returns 404 for unknown products and 400 for invalid payloads', async () => {
    expect((await place(alice.token, [{ productId: 987654, quantity: 1 }])).status).toBe(404);
    expect((await place(alice.token, [])).status).toBe(400);
    expect((await place(alice.token, [{ productId: product.id, quantity: 0 }])).status).toBe(400);
  });

  it('does not oversell under concurrent orders', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => place(alice.token, [{ productId: product.id, quantity: 4 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2); // 10 / 4 -> only 2 succeed
    expect(await stockOf(product.id)).toBe(2);
  });

  it('prevents admins from placing orders (customer-only)', async () => {
    expect((await place(admin, [{ productId: product.id, quantity: 1 }])).status).toBe(403);
  });

  it('isolates customers: own orders only, admin sees everything', async () => {
    const order = (await place(alice.token, [{ productId: product.id, quantity: 1 }])).body;
    expect((await request(app).get(`/api/orders/${order.id}`).set(bearer(bob.token))).status).toBe(404);
    expect((await request(app).get(`/api/orders/${order.id}`).set(bearer(alice.token))).status).toBe(200);
    expect((await request(app).get(`/api/orders/${order.id}`).set(bearer(admin))).status).toBe(200);

    const bobList = await request(app).get('/api/orders').set(bearer(bob.token));
    expect(bobList.body.data).toHaveLength(0);
    const adminList = await request(app).get('/api/orders').set(bearer(admin));
    expect(adminList.body.pagination.total).toBeGreaterThan(0);
  });

  it('lets only admins change status, enforcing valid transitions', async () => {
    const order = (await place(alice.token, [{ productId: product.id, quantity: 1 }])).body;
    const patch = (token, status) =>
      request(app).patch(`/api/orders/${order.id}/status`).set(bearer(token)).send({ status });

    expect((await patch(alice.token, 'confirmed')).status).toBe(403);
    expect((await patch(admin, 'confirmed')).body.status).toBe('confirmed');
    expect((await patch(admin, 'delivered')).status).toBe(409); // must ship first
    expect((await patch(admin, 'shipped')).status).toBe(200);
    expect((await patch(admin, 'delivered')).status).toBe(200);
    expect((await patch(admin, 'cancelled')).status).toBe(409);
  });

  it('restores stock when an order is cancelled', async () => {
    const order = (await place(alice.token, [{ productId: product.id, quantity: 6 }])).body;
    expect(await stockOf(product.id)).toBe(4);
    const res = await request(app).patch(`/api/orders/${order.id}/status`).set(bearer(admin)).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(await stockOf(product.id)).toBe(10);
  });

  it('protects referential integrity: cannot delete a product that has orders', async () => {
    await place(alice.token, [{ productId: product.id, quantity: 1 }]);
    const res = await request(app).delete(`/api/products/${product.id}`).set(bearer(admin));
    expect(res.status).toBe(409);
  });
});
