const path = require('node:path');
const os = require('node:os');
const express = require('express');
const session = require('express-session');
const { seedDemoData } = require('./database/seed');
const dashboardRoutes = require('./routes/dashboardRoutes');
const sourceRoutes = require('./routes/sourceRoutes');
const dependentRoutes = require('./routes/dependentRoutes');
const correctionRoutes = require('./routes/correctionRoutes');
const auditRoutes = require('./routes/auditRoutes');
const collegeRoutes = require('./routes/collegeRoutes');
const authRoutes = require('./routes/authRoutes');
const { isAuthenticated, requireAuthenticatedApi, requireAuthenticatedPage } = require('./middleware/requireAuth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'corrigen.sid',
    secret: process.env.CORRIGEN_SESSION_SECRET || 'corrigen-local-demo-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.CORRIGEN_SECURE_COOKIE === 'true',
      maxAge: 2 * 60 * 60 * 1000,
      path: '/'
    }
  }));

  app.use('/api/auth', authRoutes);
  app.get('/login', (req, res) => {
    if (isAuthenticated(req)) return res.redirect(302, '/');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });
  app.get('/login.html', (req, res) => res.redirect(302, '/login'));
  app.get('/', (req, res, next) => {
    if (!isAuthenticated(req)) return res.redirect(302, '/login');
    return requireAuthenticatedPage(req, res, () => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  });
  app.get(['/dashboard', '/dashboard/'], (req, res) => res.redirect(302, isAuthenticated(req) ? '/' : '/login'));
  app.get('/index.html', requireAuthenticatedPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.use(express.static(path.join(__dirname, 'public'), { index: false }));
  app.use('/api', requireAuthenticatedApi);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/sources', sourceRoutes);
  app.use('/api/dependents', dependentRoutes);
  app.use('/api', correctionRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/college', collegeRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Request body must be valid JSON.' });
    console.error(`Request failed (${req.method} ${req.originalUrl}):`, err.stack || err.message);
    const status = err.status === 413 ? 413 : 500;
    return res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'An unexpected server error occurred.' });
  });
  return app;
}

if (require.main === module) {
  seedDemoData();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`CORRIGEN is available at http://localhost:${port}`);
    const addresses = [...new Set(Object.values(os.networkInterfaces()).flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => address.address))];
    for (const address of addresses) console.log(`Same-network access: http://${address}:${port}`);
  });
}

module.exports = { createApp };
