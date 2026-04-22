// services/renewal/renewalService.js
const { v4: uuidv4 } = require('uuid');
const { getConnection } = require('../../db/oracle');
const emailService = require('../notification/emailService');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── POST: Request Membership Renewal ────────────────────────────────────────────
async function requestRenewal(studentId) {
  let conn;
  try {
    conn = await getConnection();
    
    // Check for active membership
    const membershipResult = await conn.execute(
      `SELECT MEMBERSHIP_ID, MEMBERSHIP_NUMBER, END_DATE, STATUS FROM MEMBERSHIP
       WHERE STUDENT_ID = :sid AND STATUS = 'active'
       ORDER BY END_DATE DESC FETCH FIRST 1 ROW ONLY`,
      { sid: studentId }
    );
    
    if (membershipResult.rows.length === 0) {
      throw appError('No active membership found.', 404, 'NO_ACTIVE_MEMBERSHIP');
    }
    
    const membership = membershipResult.rows[0];
    
    // Get student email
    const studentResult = await conn.execute(
      `SELECT FIRST_NAME, EMAIL FROM STUDENT WHERE STUDENT_ID = :sid`,
      { sid: studentId }
    );
    
    const student = studentResult.rows[0];
    
    // Create renewal token
    const token = uuidv4();
    await conn.execute(
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN), :sid, :tok, 'membership_renewal',
               SYSTIMESTAMP + INTERVAL '48' HOUR)`,
      { sid: studentId, tok: token }
    );
    await conn.commit();
    
    // Send renewal email
    const renewalLink = `${process.env.PORTAL_URL || 'http://localhost:3000'}/renew?token=${token}`;
    const template = emailService.renewalLinkEmail(student.FIRST_NAME, renewalLink);
    await emailService.sendEmail({ to: student.EMAIL, ...template });
    
    return {
      message: 'Renewal link sent to your email.',
      membershipId: membership.MEMBERSHIP_ID,
      currentEndDate: membership.END_DATE
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Get Renewal Details ───────────────────────────────────────────────────
async function getRenewalByToken(token) {
  let conn;
  try {
    conn = await getConnection();
    
    const result = await conn.execute(
      `SELECT t.TOKEN_ID AS RENEWAL_ID, t.STUDENT_ID, t.TOKEN_TYPE,
              t.IS_USED, t.EXPIRES_AT,
              TO_CHAR(t.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT,
              s.FIRST_NAME, s.LAST_NAME, s.EMAIL,
              m.MEMBERSHIP_ID, m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS MEMBERSHIP_END_DATE
       FROM VERIFICATION_TOKEN t
       JOIN STUDENT s ON t.STUDENT_ID = s.STUDENT_ID
       LEFT JOIN (
         SELECT STUDENT_ID, MEMBERSHIP_ID, MEMBERSHIP_NUMBER, STATUS, END_DATE,
                ROW_NUMBER() OVER (PARTITION BY STUDENT_ID ORDER BY START_DATE DESC) AS RN
         FROM MEMBERSHIP
       ) m ON t.STUDENT_ID = m.STUDENT_ID AND m.RN = 1
       WHERE t.TOKEN_VALUE = :tok AND t.TOKEN_TYPE = 'membership_renewal'`,
      { tok: token }
    );
    
    if (result.rows.length === 0) {
      throw appError('Invalid or expired renewal token.', 404, 'NOT_FOUND');
    }
    
    const row = result.rows[0];
    return {
      renewal: {
        renewalId: row.RENEWAL_ID,
        studentId: row.STUDENT_ID,
        firstName: row.FIRST_NAME,
        lastName: row.LAST_NAME,
        email: row.EMAIL,
        isUsed: row.IS_USED,
        expiresAt: row.EXPIRES_AT,
        membershipId: row.MEMBERSHIP_ID,
        membershipNumber: row.MEMBERSHIP_NUMBER,
        membershipStatus: row.MEMBERSHIP_STATUS,
        membershipEndDate: row.MEMBERSHIP_END_DATE
      }
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Process Membership Renewal ──────────────────────────────────────────
async function processRenewal(token) {
  let conn;
  try {
    conn = await getConnection();
    
    // Find valid token
    const tokenResult = await conn.execute(
      `SELECT TOKEN_ID, STUDENT_ID FROM VERIFICATION_TOKEN
       WHERE TOKEN_VALUE = :tok AND TOKEN_TYPE = 'membership_renewal'
       AND IS_USED = 0 AND EXPIRES_AT > SYSTIMESTAMP`,
      { tok: token }
    );
    
    if (tokenResult.rows.length === 0) {
      throw appError('Invalid or expired renewal token.', 400, 'INVALID_TOKEN');
    }
    
    const { STUDENT_ID } = tokenResult.rows[0];
    
    // Get latest membership
    const membershipResult = await conn.execute(
      `SELECT MEMBERSHIP_ID FROM MEMBERSHIP
       WHERE STUDENT_ID = :sid AND STATUS = 'active'
       ORDER BY END_DATE DESC FETCH FIRST 1 ROW ONLY`,
      { sid: STUDENT_ID }
    );
    
    if (membershipResult.rows.length === 0) {
      throw appError('No active membership found to renew.', 404, 'NO_ACTIVE_MEMBERSHIP');
    }
    
    const oldMembershipId = membershipResult.rows[0].MEMBERSHIP_ID;
    
    // Create new membership period (extend by 1 year)
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    
    const membershipNumber = `CLB-${STUDENT_ID}-RENEW-${Date.now()}`;
    
    // Insert new membership (no payment required for renewal - free extension)
    await conn.execute(
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP), :sid, :mno,
               TRUNC(SYSDATE), ADD_MONTHS(TRUNC(SYSDATE), 12), 'active')`,
      { sid: STUDENT_ID, mno: membershipNumber }
    );
    
    // Mark token as used
    await conn.execute(
      `UPDATE VERIFICATION_TOKEN SET IS_USED = 1 WHERE TOKEN_VALUE = :tok`,
      { tok: token }
    );
    
    await conn.commit();
    
    return {
      message: 'Membership renewed successfully!',
      newMembershipNumber: membershipNumber,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = {
  requestRenewal,
  getRenewalByToken,
  processRenewal
};