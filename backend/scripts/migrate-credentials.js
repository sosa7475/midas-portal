require('dotenv').config();
const { pool } = require('../src/db/client');
const { migrateCredentials } = require('../src/services/credential-migration');
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/migrate-credentials.js [--apply]');
  const client = await pool.connect();
  try { console.log(JSON.stringify(await migrateCredentials(client, { apply: process.argv.includes('--apply') }))); }
  finally { client.release(); }
}
main().catch(() => { console.error('Credential migration failed; no changes committed. Check configuration and legacy data.'); process.exitCode = 1; }).finally(() => pool.end());
