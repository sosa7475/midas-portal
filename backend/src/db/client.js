const { Pool } = require('pg');
const { databaseConfig } = require('./config');

const pool = new Pool({
  ...databaseConfig(process.env),
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Database pool error');
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
