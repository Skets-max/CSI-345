// server.js – Main application entry point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { initPool } = require('./db/oracle');
const routes = require('./routes');
const { errorHandler } = require('./middleware');
const { session, memoryStore, keycloak } = require('./middleware/keycloak');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Stripe Webhook: needs raw body BEFORE json parser ───────────────────────
app.use('/payments/webhooks/gateway', express.raw({ type: 'application/json' }));

// ─── Safe JSON serializer (handles Oracle circular references) ────────────────
app.set('json replacer', (() => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  };
})());

// ─── Global Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-please',
  resave: false,
  saveUninitialized: false,
  store: memoryStore,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));
app.use(keycloak.middleware());

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many authentication attempts.' },
});

app.use(globalLimiter);
app.use('/registrations', authLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Student Club Portal API', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/', routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'The requested endpoint does not exist.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await initPool();
    app.listen(PORT, () => {
      console.log(`🚀 Student Club Portal API running on port ${PORT}`);
      console.log(`📋 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  const { closePool } = require('./db/oracle');
  console.log('\nShutting down gracefully...');
  await closePool();
  process.exit(0);
});

start();
