const { ApiError } = require('../utils/helpers');

const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return next(new ApiError(400, 'Validation failed', error.details.map((d) => d.message)));
  }
  req[source] = value;
  next();
};

module.exports = validate;
