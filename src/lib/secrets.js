// AES-256-GCM for small secrets stored in the database (e.g. a workshop's PayFast passphrase).
// Key: SECRETS_KEY (any string) or, failing that, JWT_SECRET. Changing the key makes stored secrets unreadable.
const crypto = require('crypto');
const { config } = require('../config');

const key = () => crypto.createHash('sha256').update(process.env.SECRETS_KEY || config.jwtSecret).digest();

function encrypt(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}
module.exports = { encrypt, decrypt };
