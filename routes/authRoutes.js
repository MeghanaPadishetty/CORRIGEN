const express = require('express');
const { demoAccount, credentialsMatch } = require('../auth/demoAccount');
const { isAuthenticated, markPrivate } = require('../middleware/requireAuth');

const router = express.Router();
const secureCookie = process.env.CORRIGEN_SECURE_COOKIE === 'true';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: secureCookie,
  path: '/'
};

function establishSession(request, response) {
  request.session.regenerate((error) => {
    if (error) {
      console.error('Session creation failed:', error.message);
      return response.status(500).json({ error: 'Unable to sign in. Please try again.' });
    }
    request.session.user = { email: demoAccount.email, name: 'CORRIGEN Demo Administrator' };
    request.session.save((saveError) => {
      if (saveError) {
        console.error('Session save failed:', saveError.message);
        return response.status(500).json({ error: 'Unable to sign in. Please try again.' });
      }
      markPrivate(response);
      return response.json({ authenticated: true, user: request.session.user });
    });
  });
}

router.post('/login', (request, response) => {
  const { email, password } = request.body || {};
  if (typeof email !== 'string' || !email.trim()) return response.status(400).json({ error: 'Please enter your email address.' });
  if (typeof password !== 'string' || !password) return response.status(400).json({ error: 'Please enter your password.' });
  if (!credentialsMatch(email, password)) return response.status(401).json({ error: 'Invalid email or password.' });
  return establishSession(request, response);
});

router.post('/demo', (request, response) => {
  if (!credentialsMatch(demoAccount.email, demoAccount.password)) {
    return response.status(500).json({ error: 'Unable to sign in. Please try again.' });
  }
  return establishSession(request, response);
});

router.get('/session', (request, response) => {
  markPrivate(response);
  return isAuthenticated(request)
    ? response.json({ authenticated: true, user: request.session.user })
    : response.status(401).json({ authenticated: false });
});

router.post('/logout', (request, response) => {
  markPrivate(response);
  if (!request.session) {
    response.clearCookie('corrigen.sid', cookieOptions);
    return response.json({ authenticated: false });
  }
  request.session.destroy((error) => {
    if (error) {
      console.error('Session destruction failed:', error.message);
      return response.status(500).json({ error: 'Unable to sign out. Please try again.' });
    }
    response.clearCookie('corrigen.sid', cookieOptions);
    return response.json({ authenticated: false });
  });
});

module.exports = router;
