const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const secured = [{ bearerAuth: [] }];
const err = (description) => ({ description, content: json(ref('Error')) });

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'InventoryPro API',
    version: '1.0.0',
    description: 'Inventory & Order Management REST API. Authorize with a JWT from /auth/login (admin: see README for seeded credentials).',
  },
  servers: [{ url: '/api' }],
  tags: [{ name: 'Auth' }, { name: 'Categories' }, { name: 'Products' }, { name: 'Orders' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { message: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } } },
      Register: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } } },
      Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
      Category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string', nullable: true } } },
      Product: { type: 'object', properties: { id: { type: 'integer' }, categoryId: { type: 'integer', nullable: true }, sku: { type: 'string' }, name: { type: 'string' }, description: { type: 'string', nullable: true }, price: { type: 'number' }, stockQuantity: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      ProductInput: { type: 'object', required: ['sku', 'name', 'price'], properties: { sku: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', minimum: 0 }, stockQuantity: { type: 'integer', minimum: 0 }, categoryId: { type: 'integer', nullable: true } } },
      StockUpdate: { type: 'object', description: 'Provide exactly one of change or quantity', properties: { change: { type: 'integer', example: -5 }, quantity: { type: 'integer', minimum: 0, example: 100 } } },
      OrderInput: { type: 'object', required: ['items'], properties: { items: { type: 'array', minItems: 1, items: { type: 'object', required: ['productId', 'quantity'], properties: { productId: { type: 'integer' }, quantity: { type: 'integer', minimum: 1 } } } } } },
      Order: { type: 'object', properties: { id: { type: 'integer' }, userId: { type: 'integer' }, status: { type: 'string', enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] }, totalAmount: { type: 'number' }, createdAt: { type: 'string', format: 'date-time' }, items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'integer' }, name: { type: 'string' }, sku: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'number' } } } } } },
    },
  },
  paths: {
    '/auth/register': { post: { tags: ['Auth'], summary: 'Register a customer account', requestBody: { required: true, content: json(ref('Register')) }, responses: { 201: { description: 'Created (returns user + JWT)' }, 400: err('Validation failed'), 409: err('Email already registered') } } },
    '/auth/login': { post: { tags: ['Auth'], summary: 'Log in and receive a JWT', requestBody: { required: true, content: json(ref('Login')) }, responses: { 200: { description: 'OK (returns user + JWT)' }, 401: err('Invalid credentials') } } },
    '/categories': {
      get: { tags: ['Categories'], summary: 'List categories', responses: { 200: { description: 'OK' } } },
      post: { tags: ['Categories'], summary: 'Create category (admin)', security: secured, requestBody: { required: true, content: json(ref('Category')) }, responses: { 201: { description: 'Created' }, 403: err('Forbidden'), 409: err('Duplicate name') } },
    },
    '/categories/{id}': { delete: { tags: ['Categories'], summary: 'Delete category (admin)', security: secured, parameters: [idParam], responses: { 204: { description: 'Deleted' }, 404: err('Not found') } } },
    '/products': {
      get: { tags: ['Products'], summary: 'List products (Redis-cached; see X-Cache header)', parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        { name: 'categoryId', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['name', 'price', 'created_at'] } },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ], responses: { 200: { description: 'OK' } } },
      post: { tags: ['Products'], summary: 'Create product (admin)', security: secured, requestBody: { required: true, content: json(ref('ProductInput')) }, responses: { 201: { description: 'Created', content: json(ref('Product')) }, 400: err('Validation failed'), 403: err('Forbidden'), 409: err('Duplicate SKU') } },
    },
    '/products/low-stock': { get: { tags: ['Products'], summary: 'Products at or below a stock threshold (admin)', security: secured, parameters: [{ name: 'threshold', in: 'query', schema: { type: 'integer', default: 10 } }], responses: { 200: { description: 'OK' } } } },
    '/products/{id}': {
      get: { tags: ['Products'], summary: 'Get product by id (cached)', parameters: [idParam], responses: { 200: { description: 'OK', content: json(ref('Product')) }, 404: err('Not found') } },
      put: { tags: ['Products'], summary: 'Update product (admin)', security: secured, parameters: [idParam], requestBody: { required: true, content: json(ref('ProductInput')) }, responses: { 200: { description: 'OK' }, 404: err('Not found') } },
      delete: { tags: ['Products'], summary: 'Delete product (admin)', security: secured, parameters: [idParam], responses: { 204: { description: 'Deleted' }, 404: err('Not found'), 409: err('Product is referenced by orders') } },
    },
    '/products/{id}/stock': { patch: { tags: ['Products'], summary: 'Adjust or set stock level (admin)', security: secured, parameters: [idParam], requestBody: { required: true, content: json(ref('StockUpdate')) }, responses: { 200: { description: 'OK' }, 400: err('Invalid / would go negative'), 404: err('Not found') } } },
    '/orders': {
      get: { tags: ['Orders'], summary: 'List orders (customers: own; admins: all)', security: secured, parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
      ], responses: { 200: { description: 'OK' } } },
      post: { tags: ['Orders'], summary: 'Place an order (customer) — atomically decrements stock', security: secured, requestBody: { required: true, content: json(ref('OrderInput')) }, responses: { 201: { description: 'Created', content: json(ref('Order')) }, 404: err('Product not found'), 409: err('Insufficient stock') } },
    },
    '/orders/{id}': { get: { tags: ['Orders'], summary: 'Get order by id', security: secured, parameters: [idParam], responses: { 200: { description: 'OK', content: json(ref('Order')) }, 404: err('Not found') } } },
    '/orders/{id}/status': { patch: { tags: ['Orders'], summary: 'Update order status (admin); cancelling restores stock', security: secured, parameters: [idParam], requestBody: { required: true, content: json({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['confirmed', 'shipped', 'delivered', 'cancelled'] } } }) }, responses: { 200: { description: 'OK' }, 409: err('Invalid transition') } } },
  },
};
