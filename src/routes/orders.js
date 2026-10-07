const router = require('express').Router();
const Joi = require('joi');
const db = require('../config/db');
const cache = require('../config/cache');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, parseId } = require('../utils/helpers');

const ORDER_COLS = `id, user_id AS "userId", status, total_amount::float8 AS "totalAmount", created_at AS "createdAt"`;
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const createSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    productId: Joi.number().integer().positive().required(),
    quantity: Joi.number().integer().min(1).required(),
  })).min(1).unique('productId').required(),
});
const statusSchema = Joi.object({ status: Joi.string().valid(...STATUSES).required() });
const listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...STATUSES),
});

async function attachItems(executor, orders) {
  if (!orders.length) return orders;
  const { rows } = await executor.query(
    `SELECT oi.order_id AS "orderId", oi.product_id AS "productId", p.name, p.sku,
            oi.quantity, oi.unit_price::float8 AS "unitPrice"
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ANY($1) ORDER BY oi.id`,
    [orders.map((o) => o.id)]
  );
  return orders.map((o) => ({ ...o, items: rows.filter((r) => r.orderId === o.id).map(({ orderId, ...i }) => i) }));
}

// POST /api/orders — customer places an order (atomic: validates + decrements stock)
router.post('/', authenticate, authorize('customer'), validate(createSchema), asyncHandler(async (req, res) => {
  const { items } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ids = items.map((i) => i.productId);
    // Row locks (ordered by id to avoid deadlocks) prevent overselling under concurrency
    const { rows: products } = await client.query(
      'SELECT id, name, price, stock_quantity FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = 0;
    for (const { productId, quantity } of items) {
      const p = byId.get(productId);
      if (!p) throw new ApiError(404, `Product ${productId} not found`);
      if (p.stock_quantity < quantity) {
        throw new ApiError(409, `Insufficient stock for "${p.name}" (available: ${p.stock_quantity})`);
      }
      total += Number(p.price) * quantity;
    }

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING ${ORDER_COLS}`,
      [req.user.id, total.toFixed(2)]);
    for (const { productId, quantity } of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [order.id, productId, quantity, byId.get(productId).price]);
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2',
        [quantity, productId]);
    }
    const [full] = await attachItems(client, [order]);
    await client.query('COMMIT');
    await cache.invalidateProducts();
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// GET /api/orders — customers see their own orders, admins see all
router.get('/', authenticate, validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;
  const where = [];
  const params = [];
  if (req.user.role === 'customer') { params.push(req.user.id); where.push(`user_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM orders ${clause}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS} FROM orders ${clause} ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]);
  res.json({ data: await attachItems(db, rows), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await db.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1`, [id]);
  const order = rows[0];
  // Customers cannot tell whether other users' orders exist
  if (!order || (req.user.role === 'customer' && order.userId !== req.user.id)) {
    throw new ApiError(404, 'Order not found');
  }
  res.json((await attachItems(db, [order]))[0]);
}));

// PATCH /api/orders/:id/status — admin only; cancelling restores stock
router.patch('/:id/status', authenticate, authorize('admin'), validate(statusSchema), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { status: next } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new ApiError(404, 'Order not found');
    if (!TRANSITIONS[rows[0].status].includes(next)) {
      throw new ApiError(409, `Cannot change order status from "${rows[0].status}" to "${next}"`);
    }
    if (next === 'cancelled') {
      await client.query(
        `UPDATE products p SET stock_quantity = p.stock_quantity + oi.quantity, updated_at = NOW()
         FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`, [id]);
    }
    const { rows: [order] } = await client.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING ${ORDER_COLS}`, [next, id]);
    const [full] = await attachItems(client, [order]);
    await client.query('COMMIT');
    if (next === 'cancelled') await cache.invalidateProducts();
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
