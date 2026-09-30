const { parseIntoClientConfig } = require('pg-connection-string');
const { checkServerIdentity } = require('node:tls');

function databaseConfig(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid DATABASE_URL protocol');
  const mode = url.searchParams.get('sslmode') ?? env.PGSSLMODE;
  const ssl = url.searchParams.get('ssl');
  const requiresTls = env.NODE_ENV === 'production' ||
    (mode !== undefined && mode !== null && mode !== 'disable') ||
    (ssl !== null && !['0', 'false'].includes(ssl)) ||
    ['sslrootcert', 'sslcert', 'sslkey'].some(key => url.searchParams.has(key));
  if (!requiresTls) return { connectionString: url.href, ssl: false };
  // Parse first: pg otherwise lets connection-string settings override ssl options.
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.delete('ssl');
  url.searchParams.delete('uselibpqcompat');
  const config = parseIntoClientConfig(url.href);
  const host = config.host || url.hostname;
  return { ...config, ssl: {
    ...(typeof config.ssl === 'object' ? config.ssl : {}),
    rejectUnauthorized: true,
    checkServerIdentity: (_servername, certificate) => checkServerIdentity(host, certificate),
  } };
}

module.exports = { databaseConfig };
