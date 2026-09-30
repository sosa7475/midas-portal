const crypto = require('crypto');

function encryptionKey() {
  const value = process.env.ENCRYPTION_KEY;
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value) || /^0+$/.test(value)) {
    throw new Error('A nonzero 32-byte hexadecimal ENCRYPTION_KEY is required');
  }
  return Buffer.from(value, 'hex');
}

function encrypt(text) {
  const key = encryptionKey();
  if (typeof text !== 'string') throw new Error('Credential must be a string');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}

function decrypt(encryptedText) {
  const key = encryptionKey();
  if (typeof encryptedText !== 'string') throw new Error('Invalid encrypted credential');
  const parts = encryptedText.split(':');
  if (parts[0] === 'v1') {
    const [, iv, tag, data] = parts;
    if (parts.length !== 4 || !/^[a-fA-F0-9]{24}$/.test(iv) ||
        !/^[a-fA-F0-9]{32}$/.test(tag) || !/^(?:[a-fA-F0-9]{2})*$/.test(data)) {
      throw new Error('Invalid encrypted credential');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
  }

  // Read existing CBC records using the configured key until they are migrated.
  // Never substitute a public fallback key for legacy data.
  const [iv, data] = parts;
  if (parts.length !== 2 || !/^[a-fA-F0-9]{32}$/.test(iv) ||
      !/^(?:[a-fA-F0-9]{32})+$/.test(data)) {
    throw new Error('Invalid encrypted credential');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
