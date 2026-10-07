# InventoryPro — Inventory & Order Management REST API

A RESTful inventory and order-management backend built with **Node.js, Express, PostgreSQL, Redis and Docker**.

## Features
- **10+ REST endpoints** across products, categories, stock levels and orders (full CRUD for products)
- **Normalized PostgreSQL schema — 5 related tables** (`users`, `categories`, `products`, `orders`, `order_items`) with foreign keys, `CHECK` constraints and `UNIQUE` constraints enforcing referential integrity
- **Redis caching** of the product catalog (list + detail), with version-based invalidation on every write and graceful fallback if Redis is down (`X-Cache: HIT|MISS` header)
- **JWT authentication** with **role-based access control** (`admin` / `customer`)
- **Transactional orders**: row-level locking (`SELECT … FOR UPDATE`) prevents overselling; cancelling an order restores stock
- **Jest + Supertest** integration tests covering CRUD, auth, RBAC, stock and order flows
- **Docker** + `docker compose`, **GitHub Actions CI/CD** (test → build → push image to GHCR), **Swagger/OpenAPI** docs

## One-command local setup
```bash
docker compose up --build
```
- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api-docs
- Seeded admin: `admin@inventorypro.com` / `Admin@1234` (override via `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

The container runs migrations and seeds an admin + sample catalog automatically.

## Running without Docker
```bash
cp .env.example .env        # edit values
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

## Tests
Tests are integration tests against a real PostgreSQL (and Redis, if `REDIS_URL` is set).
```bash
createdb inventorypro_test
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/inventorypro_test
export REDIS_URL=redis://localhost:6379   # optional; enables the cache test
npm run db:migrate
npm test
```

## Endpoints
| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | public |
| GET | `/api/categories` | public |
| POST / DELETE | `/api/categories`, `/api/categories/:id` | admin |
| GET | `/api/products`, `/api/products/:id` (cached) | public |
| POST / PUT / DELETE | `/api/products`, `/api/products/:id` | admin |
| PATCH | `/api/products/:id/stock` (`{change}` or `{quantity}`) | admin |
| GET | `/api/products/low-stock?threshold=10` | admin |
| POST | `/api/orders` | customer |
| GET | `/api/orders`, `/api/orders/:id` | customer (own) / admin (all) |
| PATCH | `/api/orders/:id/status` | admin |

Order status flow: `pending → confirmed → shipped → delivered` (`cancelled` allowed from pending/confirmed, restores stock).

## Project structure
```
src/
  app.js, server.js
  config/      db.js (pg pool), cache.js (Redis)
  middleware/  auth.js (JWT + RBAC), validate.js (Joi), error.js
  routes/      auth, categories, products, orders
  docs/        openapi.js (Swagger spec)
db/schema.sql  scripts/ (migrate, seed)  tests/
Dockerfile  docker-compose.yml  .github/workflows/ci.yml
```
