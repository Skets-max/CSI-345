// services/passwordResetService.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getConnection } = require('../../db/oracle');
const emailService = require('../notification/emailService');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── POST: Request Password Reset ─────────────────────────────────────────────
async function requestPasswordReset(universityEmail) {
  let conn;
  try {
    conn = await getConnection();
    
    // Find student by email
    const studentResult = await conn.execute(
      `SELECT STUDENT_ID FROM STUDENT WHERE EMAIL = :email`,
      { email: universityEmail.toLowerCase() }
    );
    
    if (studentResult.rows.length === 0) {
      // Don't reveal if email exists
      return { message: 'If that email exists, a reset link has been sent.' };
    }
    
    const studentId = studentResult.rows[0].STUDENT_ID;
    
    // Create reset token
    const token = uuidv4();
    await conn.execute(
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN), :sid, :tok, 'password_reset',
               SYSTIMESTAMP + INTERVAL '1' HOUR)`,
      { sid: studentId, tok: token }
    );
    await conn.commit();
    
    // Send reset email
    const resetLink = `${process.env.PORTAL_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    console.log(`=== PASSWORD RESET TOKEN FOR ${universityEmail} ===`);
    console.log(`Token: ${token}`);
    console.log(`Link: ${resetLink}`);
    console.log(`=========================================`);
    const template = emailService.passwordResetEmail('User', resetLink);
    await emailService.sendEmail({ to: universityEmail, ...template });
    
    return { message: 'If that email exists, a reset link has been sent.' };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Reset Password ──────────────────────────────────────────────────────
async function resetPassword(token, newPassword) {
  let conn;
  try {
    conn = await getConnection();
    
    // Find valid token
    const tokenResult = await conn.execute(
      `SELECT TOKEN_ID, STUDENT_ID FROM VERIFICATION_TOKEN
       WHERE TOKEN_VALUE = :tok AND TOKEN_TYPE = 'password_reset'
       AND IS_USED = 0 AND EXPIRES_AT > SYSTIMESTAMP`,
      { tok: token }
    );
    
    if (tokenResult.rows.length === 0) {
      throw appError('Invalid or expired reset token.', 400, 'INVALID_TOKEN');
    }
    
    const { STUDENT_ID } = tokenResult.rows[0];
    
    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    // Update password
    await conn.execute(
      `UPDATE STUDENT SET PASSWORD_HASH = :pw WHERE STUDENT_ID = :sid`,
      { pw: passwordHash, sid: STUDENT_ID }
    );
    
    // Mark token as used
    await conn.execute(
      `UPDATE VERIFICATION_TOKEN SET IS_USED = 1 WHERE TOKEN_VALUE = :tok`,
      { tok: token }
    );
    
    await conn.commit();
    
    return { message: 'Password reset successfully. You can now login.' };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = {
  requestPasswordReset,
  resetPassword
};