const crypto = require('crypto');
const base64Url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const keyId = base64Url(crypto.randomBytes(8));
const secret = base64Url(crypto.randomBytes(32));
const apiKey = `ck_${keyId}_${secret}`;
console.log('apiKey', apiKey);
const parse = (apiKey) => {
  if (!apiKey) return null;
  if (!apiKey.startsWith('ck_')) return null;
  const rest = apiKey.slice(3);
  const idx = rest.indexOf('_');
  if (idx <= 0) return null;
  const keyId = rest.slice(0, idx);
  const secret = rest.slice(idx + 1);
  return { keyId, secret };
};
console.log('parsed', parse(apiKey));
