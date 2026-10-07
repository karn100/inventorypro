const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/config/db');

const resetDb = () =>
  db.query('TRUNCATE order_items, orders, products, categories, users RESTART IDENTITY CASCADE');

async function createAdmin() {
  const hash = await bcrypt.hash('Admin@1234', 4);
  await db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@test.com', $1, 'admin')", [hash]);
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Admin@1234' });
  return res.body.token;
}

async function createCustomer(email = 'cust@test.com') {
  const res = await request(app).post('/api/auth/register')
    .send({ name: 'Test Customer', email, password: 'Pass@1234' });
  return { token: res.body.token, id: res.body.user.id };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function createProduct(adminToken, overrides = {}) {
  const res = await request(app).post('/api/products').set(bearer(adminToken))
    .send({ sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, name: 'Widget', price: 10.5, stockQuantity: 20, ...overrides });
  return res.body;
}

module.exports = { app, db, resetDb, createAdmin, createCustomer, createProduct, bearer };
