const request = require('supertest');
const { app, db, resetDb, createAdmin, createCustomer, bearer } = require('./helpers');

beforeAll(resetDb);
afterAll(() => db.pool.end());

describe('Auth & role-based access control', () => {
  it('registers a customer and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Jane', email: 'jane@test.com', password: 'Secret@123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'jane@test.com', role: 'customer' });
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects duplicate email with 409', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Jane', email: 'jane@test.com', password: 'Secret@123' });
    expect(res.status).toBe(409);
  });

  it('validates registration input', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'J', email: 'nope', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('logs in with valid credentials and rejects invalid ones', async () => {
    const ok = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'Secret@123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeDefined();
    const bad = await request(app).post('/api/auth/login').send({ email: 'jane@test.com', password: 'wrong-pass' });
    expect(bad.status).toBe(401);
  });

  it('requires a token for protected routes', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await request(app).get('/api/orders').set(bearer('garbage'))).status).toBe(401);
  });

  it('blocks customers from admin endpoints but allows admins', async () => {
    const { token: customer } = await createCustomer('c1@test.com');
    const admin = await createAdmin();
    const body = { sku: 'RBAC-1', name: 'Thing', price: 5 };
    expect((await request(app).post('/api/products').set(bearer(customer)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/products').set(bearer(admin)).send(body)).status).toBe(201);
  });
});
