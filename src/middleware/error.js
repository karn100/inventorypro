const { ApiError } = require('../utils/helpers');

const notFound = (req, res, next) => next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found`));

// Centralized, structured error handling
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Malformed JSON body' } });
  }
  const pgErrors = {
    '23505': [409, 'Resource already exists'],
    '23503': [409, 'Operation conflicts with related records'],
    '23514': [400, 'Value violates a constraint (e.g. stock cannot go negative)'],
    '22P02': [400, 'Invalid input format'],
  };
  if (pgErrors[err.code]) {
    const [status, message] = pgErrors[err.code];
    return res.status(status).json({ error: { message } });
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: { message: 'Internal server error' } });
}

module.exports = { notFound, errorHandler };
