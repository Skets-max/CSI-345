// services/membership/membershipService.js
const { getConnection } = require('../../db/oracle');
const emailService = require('../notification/emailService');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── GET: List All Members (admin) ────────────────────────────────────────────
async function getAllMembers({ status, page = 1, limit = 20 } = {}) {
  let conn;
  try {
    conn = await getConnection();
    const offset = (page - 1) * limit;

    // Total count
    const countResult = await conn.execute(
      `SELECT COUNT(*) AS TOTAL FROM STUDENT
       WHERE (:stat IS NULL OR ACCOUNT_STATUS = :stat)`,
      { stat: status || null }
    );
    const total = countResult.rows[0].TOTAL;

    // Paginated members with latest membership
    const result = await conn.execute(
      `SELECT s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME, s.EMAIL, s.PHONE_NUMBER,
              s.ACCOUNT_STATUS, TO_CHAR(s.CREATED_AT, 'YYYY-MM-DD') AS JOINED,
              m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.START_DATE, 'YYYY-MM-DD') AS MEMBERSHIP_START,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS MEMBERSHIP_END
       FROM STUDENT s
       LEFT JOIN (
         SELECT STUDENT_ID, MEMBERSHIP_NUMBER, STATUS, START_DATE, END_DATE,
                ROW_NUMBER() OVER (PARTITION BY STUDENT_ID ORDER BY START_DATE DESC) AS RN
         FROM MEMBERSHIP
       ) m ON s.STUDENT_ID = m.STUDENT_ID AND m.RN = 1
       WHERE (:stat IS NULL OR s.ACCOUNT_STATUS = :stat)
       ORDER BY s.CREATED_AT DESC
       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      { stat: status || null }
    );

    return {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      members: result.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Member by ID ────────────────────────────────────────────────────────
async function getMemberById(memberId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME, s.EMAIL, s.PHONE_NUMBER,
              s.ACCOUNT_STATUS, TO_CHAR(s.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT
       FROM STUDENT s
       WHERE s.STUDENT_ID = :id`,
      { id: memberId }
    );
    if (result.rows.length === 0) {
      throw appError('Member not found.', 404, 'NOT_FOUND');
    }
    return { member: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Membership Details for a Member ─────────────────────────────────────
async function getMembershipByStudentId(studentId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT m.MEMBERSHIP_ID, m.MEMBERSHIP_NUMBER, m.STATUS,
              TO_CHAR(m.START_DATE, 'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS END_DATE,
              TO_CHAR(m.RENEWAL_DATE, 'YYYY-MM-DD') AS RENEWAL_DATE,
              p.AMOUNT, p.PAYMENT_STATUS,
              TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS PAYMENT_DATE,
              p.TRANSACTION_REFERENCE
       FROM MEMBERSHIP m
       LEFT JOIN PAYMENT p ON m.PAYMENT_ID = p.PAYMENT_ID
       WHERE m.STUDENT_ID = :sid
       ORDER BY m.START_DATE DESC`,
      { sid: studentId }
    );
    if (result.rows.length === 0) {
      throw appError('No membership found for this member.', 404, 'NOT_FOUND');
    }
    return { memberships: result.rows };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Create / Activate Membership ───────────────────────────────────────
async function createMembership(studentId, paymentId) {
  let conn;
  try {
    conn = await getConnection();

    // Verify payment exists and is successful
    const paymentResult = await conn.execute(
      `SELECT PAYMENT_ID, AMOUNT, PAYMENT_STATUS FROM PAYMENT
       WHERE PAYMENT_ID = :pid AND STUDENT_ID = :sid`,
      { pid: paymentId, sid: studentId }
    );
    if (paymentResult.rows.length === 0) {
      throw appError('Payment not found.', 404, 'NOT_FOUND');
    }
    if (paymentResult.rows[0].PAYMENT_STATUS !== 'successful') {
      throw appError('Payment has not been confirmed. Cannot activate membership.', 400, 'PAYMENT_NOT_CONFIRMED');
    }

    // Allow multiple memberships - each payment creates a new membership
    // No check for existing active membership anymore

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const membershipNumber = `CLB-${studentId}-${Date.now()}`;

    await conn.execute(
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, PAYMENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP), :sid, :pid, :mno,
               TRUNC(SYSDATE), ADD_MONTHS(TRUNC(SYSDATE), 12), 'active')`,
      { sid: studentId, pid: paymentId, mno: membershipNumber }
    );

    // Update student to active if not already (in case they have pending/verified status)
    await conn.execute(
      `UPDATE STUDENT SET ACCOUNT_STATUS = 'active' WHERE STUDENT_ID = :sid AND ACCOUNT_STATUS != 'blocked'`,
      { sid: studentId }
    );

    await conn.commit();

    return {
      message: 'Membership activated successfully.',
      membershipNumber,
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

// ─── PATCH: Block Member ──────────────────────────────────────────────────────
async function blockMember(memberId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `UPDATE STUDENT SET ACCOUNT_STATUS = 'blocked' WHERE STUDENT_ID = :id`,
      { id: memberId }
    );
    if (result.rowsAffected === 0) {
      throw appError('Member not found.', 404, 'NOT_FOUND');
    }
    await conn.execute(
      `UPDATE MEMBERSHIP SET STATUS = 'blocked' WHERE STUDENT_ID = :id AND STATUS = 'active'`,
      { id: memberId }
    );
    await conn.commit();
    return { message: `Member ${memberId} has been blocked.` };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── PATCH: Unblock Member ────────────────────────────────────────────────────
async function unblockMember(memberId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `UPDATE STUDENT SET ACCOUNT_STATUS = 'active' WHERE STUDENT_ID = :id`,
      { id: memberId }
    );
    if (result.rowsAffected === 0) {
      throw appError('Member not found.', 404, 'NOT_FOUND');
    }
    await conn.execute(
      `UPDATE MEMBERSHIP SET STATUS = 'active'
       WHERE STUDENT_ID = :id AND STATUS = 'blocked' AND END_DATE >= TRUNC(SYSDATE)`,
      { id: memberId }
    );
    await conn.commit();
    return { message: `Member ${memberId} has been unblocked.` };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Member by Email ─────────────────────────────────────────────────────
async function getMemberByEmail(email) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME, s.EMAIL, s.PHONE_NUMBER,
              s.ACCOUNT_STATUS, TO_CHAR(s.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT,
              m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS MEMBERSHIP_END_DATE
       FROM STUDENT s
       LEFT JOIN (
         SELECT STUDENT_ID, MEMBERSHIP_NUMBER, STATUS, END_DATE,
                ROW_NUMBER() OVER (PARTITION BY STUDENT_ID ORDER BY START_DATE DESC) AS RN
         FROM MEMBERSHIP
       ) m ON s.STUDENT_ID = m.STUDENT_ID AND m.RN = 1
       WHERE LOWER(s.EMAIL) = LOWER(:email)`,
      { email }
    );
    if (result.rows.length === 0) {
      throw appError('Member not found.', 404, 'NOT_FOUND');
    }
    return { member: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Member (Admin) ───────────────────────────────────────────
async function deleteMember(studentId) {
  let conn;
  try {
    conn = await getConnection();
    
    // Get all related IDs first
    const memResult = await conn.execute(`SELECT MEMBERSHIP_ID FROM MEMBERSHIP WHERE STUDENT_ID = :sid`, { sid: studentId });
    const membershipIds = memResult.rows.map(r => r.MEMBERSHIP_ID);
    
    // Delete related records in proper order
    // Cards first (via membership)
    if (membershipIds.length > 0) {
      for (const mid of membershipIds) {
        await conn.execute(`DELETE FROM MEMBERSHIP_CARD WHERE MEMBERSHIP_ID = :mid`, { mid });
      }
    }
    // Then membership
    await conn.execute(`DELETE FROM MEMBERSHIP WHERE STUDENT_ID = :sid`, { sid: studentId });
    // Booking
    await conn.execute(`DELETE FROM BOOKING WHERE STUDENT_ID = :sid`, { sid: studentId });
    // Payment (this might be the issue - need to handle carefully)
    await conn.execute(`DELETE FROM PAYMENT WHERE STUDENT_ID = :sid`, { sid: studentId });
    // Notification
    await conn.execute(`DELETE FROM NOTIFICATION WHERE STUDENT_ID = :sid`, { sid: studentId });
    
    // Now delete the student
    const result = await conn.execute(`DELETE FROM STUDENT WHERE STUDENT_ID = :sid`, { sid: studentId });
    
    if (result.rowsAffected === 0) {
      throw appError('Member not found.', 404, 'NOT_FOUND');
    }
    await conn.commit();
    return { message: 'Member deleted successfully.', studentId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = {
  getAllMembers,
  getMemberById,
  getMemberByEmail,
  getMembershipByStudentId,
  createMembership,
  blockMember,
  unblockMember,
  deleteMember
};
