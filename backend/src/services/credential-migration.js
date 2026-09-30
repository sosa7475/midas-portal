const { encrypt, decrypt } = require('./encryption');

async function migrateCredentials(client, { apply = false } = {}) {
  encrypt(''); // Validate configuration before database access.
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE api_keys IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT id, encrypted_key, encrypted_secret FROM api_keys ORDER BY id');
    let changed = 0;
    for (const row of rows) {
      const output = {};
      let legacy = false;
      for (const field of ['encrypted_key', 'encrypted_secret']) {
        const value = row[field];
        if (value == null) { output[field] = value; continue; }
        const plaintext = decrypt(value); // Validate every value; abort on failure.
        if (value.startsWith('v1:')) output[field] = value;
        else { output[field] = encrypt(plaintext); legacy = true; }
      }
      if (!legacy) continue;
      changed++;
      if (apply) await client.query('UPDATE api_keys SET encrypted_key = $1, encrypted_secret = $2 WHERE id = $3', [output.encrypted_key, output.encrypted_secret, row.id]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { inspected: rows.length, legacyRecords: changed, applied: apply };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
module.exports = { migrateCredentials };
