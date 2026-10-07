const router = require('express').Router();
const Joi = require('joi');
const db = require('../config/db');
const cache = require('../config/cache');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, parseId } = require('../utils/helpers');

const COLS = `id, category_id AS "categoryId", sku, name, description,
  price::float8 AS price, stock_quantity AS "stockQuantity",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const base = {
  sku: Joi.string().trim().max(50),
  name: Joi.string().trim().max(200),
  description: Joi.string().allow('', null),
  price: Joi.number().min(0).precision(2),
  stockQuantity: Joi.number().integer().min(0),
  categoryId: Joi.number().integer().positive().allow(null),
};
const createSchema = Joi.object({
  ...base,
  sku: base.sku.required(),
  name: base.name.required(),
  price: base.price.required(),
  stockQuantity: base.stockQuantity.default(0),
});
const updateSchema = Joi.object(base).min(1);
const stockSchema = Joi.object({
  change: Joi.number().integer().invalid(0),          // relative adjustment (+/-)
  quantity: Joi.number().integer().min(0),            // absolute level
}).xor('change', 'quantity');
const listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  categoryId: Joi.number().integer().positive(),
  search: Joi.string().trim().max(100),
  sortBy: Joi.string().valid('name', 'price', 'created_at').default('created_at'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
});

// GET /api/products — cached in Redis
router.get('/', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, categoryId, search, sortBy, order } = req.query;
  const cacheKey = `list:${JSON.stringify(req.query)}`;
  const hit = await cache.getJSON(cacheKey);
  if (hit) {
    res.set('X-Cache', 'HIT');
    return res.json(hit);
  }

  const where = [];
  const params = [];
  if (categoryId) { params.push(categoryId); where.push(`category_id = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM products ${clause}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${COLS} FROM products ${clause}
     ORDER BY ${sortBy} ${order.toUpperCase()}, id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  const body = { data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  await cache.setJSON(cacheKey, body);
  if (cache.isReady()) res.set('X-Cache', 'MISS');
  res.json(body);
}));

// GET /api/products/low-stock?threshold=10 (admin) — stock level report
router.get('/low-stock', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const threshold = Math.max(0, parseInt(req.query.threshold, 10) || 10);
  const { rows } = await db.query(
    `SELECT ${COLS} FROM products WHERE stock_quantity <= $1 ORDER BY stock_quantity, id`,
    [threshold]
  );
  res.json({ threshold, data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const hit = await cache.getJSON(`item:${id}`);
  if (hit) {
    res.set('X-Cache', 'HIT');
    return res.json(hit);
  }
  const { rows } = await db.query(`SELECT ${COLS} FROM products WHERE id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  await cache.setJSON(`item:${id}`, rows[0]);
  if (cache.isReady()) res.set('X-Cache', 'MISS');
  res.json(rows[0]);
}));

router.post('/', authenticate, authorize('admin'), validate(createSchema), asyncHandler(async (req, res) => {
  const { sku, name, description, price, stockQuantity, categoryId } = req.body;
  const { rows } = await db.query(
    `INSERT INTO products (sku, name, description, price, stock_quantity, category_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
    [sku, name, description ?? null, price, stockQuantity, categoryId ?? null]
  );
  await cache.invalidateProducts();
  res.status(201).json(rows[0]);
}));

router.put('/:id', authenticate, authorize('admin'), validate(updateSchema), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const columns = { sku: 'sku', name: 'name', description: 'description', price: 'price',
    stockQuantity: 'stock_quantity', categoryId: 'category_id' };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(columns)) {
    if (req.body[key] !== undefined) { params.push(req.body[key]); sets.push(`${col} = $${params.length}`); }
  }
  params.push(id);
  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} RETURNING ${COLS}`,
    params
  );
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  await cache.invalidateProducts();
  res.json(rows[0]);
}));

// PATCH /api/products/:id/stock — adjust ({change: -5}) or set ({quantity: 50}) stock level
router.patch('/:id/stock', authenticate, authorize('admin'), validate(stockSchema), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { change, quantity } = req.body;
  const { rows } = quantity !== undefined
    ? await db.query(`UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING ${COLS}`, [quantity, id])
    : await db.query(`UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING ${COLS}`, [change, id]);
  if (!rows[0]) throw new ApiError(404, 'Product not found');
  await cache.invalidateProducts();
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [parseId(req.params.id)]);
  if (!rowCount) throw new ApiError(404, 'Product not found');
  await cache.invalidateProducts();
  res.status(204).end();
}));

module.exports = router;
