require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@inventorypro.com';
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@1234', 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', $1, $2, 'admin')
       ON CONFLICT (email) DO NOTHING`, [email, hash]);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
    if (rows[0].n === 0) {
      await pool.query(`INSERT INTO categories (name, description) VALUES
        ('Electronics', 'Devices and accessories'), ('Stationery', 'Office supplies') ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO products (category_id, sku, name, price, stock_quantity)
        SELECT c.id, v.sku, v.name, v.price, v.stock FROM (VALUES
          ('Electronics','ELEC-001','Wireless Mouse', 19.99, 150),
          ('Electronics','ELEC-002','Mechanical Keyboard', 79.50, 60),
          ('Stationery','STAT-001','A4 Notebook (pack of 5)', 8.25, 300)
        ) AS v(cat, sku, name, price, stock) JOIN categories c ON c.name = v.cat`);
    }
    console.log(`Seed complete. Admin: ${email}`);
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
