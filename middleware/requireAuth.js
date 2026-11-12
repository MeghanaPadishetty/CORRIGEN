function markPrivate(response) {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  response.set('Pragma', 'no-cache');
}

function isAuthenticated(request) {
  return Boolean(request.session && request.session.user && request.session.user.email);
}

function requireAuthenticatedPage(request, response, next) {
  markPrivate(response);
  if (!isAuthenticated(request)) return response.redirect(302, '/login');
  next();
}

function requireAuthenticatedApi(request, response, next) {
  markPrivate(response);
  if (!isAuthenticated(request)) return response.status(401).json({ error: 'Authentication required.' });
  next();
}

module.exports = { isAuthenticated, markPrivate, requireAuthenticatedPage, requireAuthenticatedApi };
