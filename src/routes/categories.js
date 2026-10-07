const router = require('express').Router();
const Joi = require('joi');
const db = require('../config/db');
const cache = require('../config/cache');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, parseId } = require('../utils/helpers');

const schema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow('', null),
});

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT id, name, description FROM categories ORDER BY name');
  res.json({ data: rows });
}));

router.post('/', authenticate, authorize('admin'), validate(schema), asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const { rows } = await db.query(
    'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING id, name, description',
    [name, description ?? null]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [parseId(req.params.id)]);
  if (!rowCount) throw new ApiError(404, 'Category not found');
  await cache.invalidateProducts(); // products.category_id is set to NULL
  res.status(204).end();
}));

module.exports = router;
