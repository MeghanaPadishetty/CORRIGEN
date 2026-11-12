const crypto = require('node:crypto');

const demoAccount = Object.freeze({
  email: (process.env.CORRIGEN_DEMO_EMAIL || 'demo@corrigen.com').trim().toLowerCase(),
  password: process.env.CORRIGEN_DEMO_PASSWORD || 'Corrigen@123'
});

function credentialsMatch(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') return false;
  if (email.trim().toLowerCase() !== demoAccount.email) return false;
  const supplied = Buffer.from(password);
  const expected = Buffer.from(demoAccount.password);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { demoAccount, credentialsMatch };
