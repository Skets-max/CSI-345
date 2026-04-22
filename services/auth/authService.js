// services/auth/authService.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../../db/oracle');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// POST /auth/login – Authenticate student or admin, return JWT
async function login(userId, password) {
  let conn;
  try {
    conn = await getConnection();

    const result = await conn.execute(
      `SELECT STUDENT_ID, FIRST_NAME, LAST_NAME, EMAIL,
              PASSWORD_HASH, ACCOUNT_STATUS
       FROM STUDENT WHERE STUDENT_ID = :id`,
      { id: userId }
    );

    if (result.rows.length === 0) {
      throw appError('Invalid user ID or password.', 401, 'INVALID_CREDENTIALS');
    }

    const student = result.rows[0];

    // Check account status
    if (student.ACCOUNT_STATUS === 'blocked') {
      throw appError('Your account has been blocked. Please contact the club administrator.', 403, 'ACCOUNT_BLOCKED');
    }
    
    // In development mode, allow login for pending/unverified accounts for testing
    if (process.env.NODE_ENV !== 'development') {
      if (student.ACCOUNT_STATUS === 'pending' || student.ACCOUNT_STATUS === 'unverified') {
        throw appError('Your account is not verified. Please verify your email first.', 403, 'ACCOUNT_NOT_VERIFIED');
      }
    }

    const passwordMatch = await bcrypt.compare(password, student.PASSWORD_HASH);
    if (!passwordMatch) {
      throw appError('Invalid user ID or password.', 401, 'INVALID_CREDENTIALS');
    }

    // Determine role (admin list can be stored in DB or env var)
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
    const role = adminIds.includes(userId) ? 'admin' : 'student';

    const token = jwt.sign(
      {
        studentId: student.STUDENT_ID,
        firstName: student.FIRST_NAME,
        lastName: student.LAST_NAME,
        email: student.EMAIL,
        role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    return {
      message: 'Login successful.',
      token,
      expiresIn: '10m',
      user: {
        userId: student.STUDENT_ID,
        firstName: student.FIRST_NAME,
        lastName: student.LAST_NAME,
        email: student.EMAIL,
        role,
        accountStatus: student.ACCOUNT_STATUS,
      }
    };
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = { login };
