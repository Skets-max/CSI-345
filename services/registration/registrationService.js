// services/registration/registrationService.js
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getConnection } = require('../../db/oracle');
const emailService = require('../notification/emailService');

// ─── Helper: throw a formatted error ─────────────────────────────────────────
function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── GET: Registration / Student Status ───────────────────────────────────────
async function getRegistrationStatus(registrationId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT STUDENT_ID, FIRST_NAME, LAST_NAME, EMAIL, PHONE_NUMBER,
              ACCOUNT_STATUS, TO_CHAR(CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT
       FROM STUDENT
       WHERE STUDENT_ID = :id`,
      { id: registrationId }
    );
    if (result.rows.length === 0) {
      throw appError('Registration not found.', 404, 'NOT_FOUND');
    }
    return { registration: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Create New Registration ────────────────────────────────────────────
async function createRegistration(data) {
  const { studentNumber, firstName, lastName, dateOfBirth, universityEmail, password } = data;
  let conn;
  try {
    // 1. Validate student with SARMS
    await validateWithSARMS({ studentNumber, firstName, lastName, dateOfBirth, universityEmail });

    conn = await getConnection();

    // 2. Check for duplicate
    const existing = await conn.execute(
      `SELECT STUDENT_ID FROM STUDENT WHERE STUDENT_ID = :id OR EMAIL = :email`,
      { id: studentNumber, email: universityEmail }
    );
    if (existing.rows.length > 0) {
      throw appError('A student with this ID or email already exists.', 409, 'DUPLICATE_STUDENT');
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Insert student
    await conn.execute(
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, ACCOUNT_STATUS)
       VALUES (:id, :fn, :ln, TO_DATE(:dob, 'YYYY-MM-DD'), :email, :pw, 'pending')`,
      {
        id: studentNumber,
        fn: firstName.trim(),
        ln: lastName.trim(),
        dob: dateOfBirth,
        email: universityEmail.toLowerCase(),
        pw: passwordHash
      }
    );

    // 5. Create email verification token
    const token = uuidv4();
    await conn.execute(
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN), :sid, :tok, 'email_verification',
               SYSTIMESTAMP + INTERVAL '24' HOUR)`,
      { sid: studentNumber, tok: token }
    );

    await conn.commit();

    // 6. Send verification email
    const verificationLink = `${process.env.PORTAL_URL || 'http://localhost:3000'}/registrations/${studentNumber}/confirm-email?token=${token}`;
    const template = emailService.verificationEmail(firstName, verificationLink);
    await emailService.sendEmail({ to: universityEmail, ...template });

    return {
      message: 'Registration successful. Please check your university email to verify your account.',
      registrationId: studentNumber,
      email: universityEmail
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Confirm Email ───────────────────────────────────────────────────────
async function confirmEmail(registrationId, token) {
  let conn;
  try {
    conn = await getConnection();

    // Find valid, unused token
    const tokenResult = await conn.execute(
      `SELECT TOKEN_ID, STUDENT_ID FROM VERIFICATION_TOKEN
       WHERE STUDENT_ID = :sid
         AND TOKEN_VALUE = :tok
         AND TOKEN_TYPE = 'email_verification'
         AND IS_USED = 0
         AND EXPIRES_AT > SYSTIMESTAMP`,
      { sid: registrationId, tok: token }
    );

    if (tokenResult.rows.length === 0) {
      throw appError('Invalid or expired verification token.', 400, 'INVALID_TOKEN');
    }

    const tokenId = tokenResult.rows[0].TOKEN_ID;

    // Mark token as used
    await conn.execute(
      `UPDATE VERIFICATION_TOKEN SET IS_USED = 1 WHERE TOKEN_ID = :tid`,
      { tid: tokenId }
    );

    // Update student status to verified
    await conn.execute(
      `UPDATE STUDENT SET ACCOUNT_STATUS = 'verified' WHERE STUDENT_ID = :sid`,
      { sid: registrationId }
    );

    await conn.commit();

    return { message: 'Email verified successfully. You may now proceed to payment to activate your membership.' };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Resend Verification Email ─────────────────────────────────────────
async function resendVerification(email) {
  let conn;
  try {
    conn = await getConnection();

    const studentResult = await conn.execute(
      `SELECT STUDENT_ID, FIRST_NAME, ACCOUNT_STATUS FROM STUDENT WHERE EMAIL = :email`,
      { email: email.toLowerCase() }
    );

    if (studentResult.rows.length === 0) {
      // Return generic message to prevent email enumeration
      return { message: 'If the email exists, a verification link has been sent.' };
    }

    const student = studentResult.rows[0];

    if (student.ACCOUNT_STATUS !== 'pending') {
      throw appError('This account is already verified.', 400, 'ALREADY_VERIFIED');
    }

    // Rate limit: max 3 tokens per hour
    const countResult = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM VERIFICATION_TOKEN
       WHERE STUDENT_ID = :sid AND TOKEN_TYPE = 'email_verification'
         AND CREATED_AT > SYSTIMESTAMP - INTERVAL '1' HOUR`,
      { sid: student.STUDENT_ID }
    );
    if (countResult.rows[0].CNT >= 3) {
      throw appError('Too many verification emails sent. Please wait before trying again.', 429, 'RATE_LIMIT_EXCEEDED');
    }

    // Invalidate old tokens
    await conn.execute(
      `UPDATE VERIFICATION_TOKEN SET IS_USED = 1
       WHERE STUDENT_ID = :sid AND TOKEN_TYPE = 'email_verification' AND IS_USED = 0`,
      { sid: student.STUDENT_ID }
    );

    // Create new token
    const token = uuidv4();
    await conn.execute(
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN), :sid, :tok, 'email_verification',
               SYSTIMESTAMP + INTERVAL '24' HOUR)`,
      { sid: student.STUDENT_ID, tok: token }
    );

    await conn.commit();

    const verificationLink = `${process.env.PORTAL_URL || 'http://localhost:3000'}/registrations/${student.STUDENT_ID}/confirm-email?token=${token}`;
    const template = emailService.verificationEmail(student.FIRST_NAME, verificationLink);
    await emailService.sendEmail({ to: email, ...template });

    return { message: 'If the email exists, a verification link has been sent.' };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── Internal: SARMS Validation ───────────────────────────────────────────────
async function validateWithSARMS({ studentNumber, firstName, lastName, dateOfBirth, universityEmail }) {
  // ALWAYS skip SARMS validation in development for easy testing
  // In production, remove or comment this line
  console.log(`[DEV] Skipping SARMS validation for student ${studentNumber}`);
  return;
  
  // Production code (commented out for dev):
  /*
  try {
    const response = await axios.post(
      `${process.env.SARMS_API_URL}/validate-student`,
      { studentNumber, firstName, lastName, dateOfBirth, universityEmail },
      {
        headers: { 'x-api-key': process.env.SARMS_API_KEY },
        timeout: 10000
      }
    );
    if (!response.data.valid) {
      throw appError(
        'Student details do not match university records. Please verify your information.',
        422,
        'SARMS_VALIDATION_FAILED'
      );
    }
  } catch (err) {
    if (err.code === 'SARMS_VALIDATION_FAILED') throw err;
    throw appError('Unable to validate student with university records. Please try again later.', 503, 'SARMS_UNAVAILABLE');
  }
  */
}

module.exports = { getRegistrationStatus, createRegistration, confirmEmail, resendVerification };
