// middleware/index.js
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { getConnection } = require('../db/oracle');

// ─── Input Validation ─────────────────────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

// ─── JWT Authentication ───────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Bearer token required.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token.' });
  }
}

// ─── Admin Role Guard ─────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required.' });
  }
  next();
}

// ─── Active Membership Guard ──────────────────────────────────────────────────
async function requireActiveMembership(req, res, next) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT MEMBERSHIP_ID FROM MEMBERSHIP
       WHERE STUDENT_ID = :sid AND STATUS = 'active' AND ROWNUM = 1`,
      { sid: req.user.studentId }
    );
    if (result.rows.length === 0) {
      return res.status(403).json({
        error: 'MEMBERSHIP_REQUIRED',
        message: 'An active membership is required to perform this action.'
      });
    }
    next();
  } catch (err) {
    next(err);
  } finally {
    if (conn) await conn.close();
  }
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${err.code || 'INTERNAL'}: ${err.message}`);
  const status = err.status || 500;
  res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred.'
  });
}

module.exports = { validate, authenticate, requireAdmin, requireActiveMembership, errorHandler };
