// services/reports/reportsService.js
const { getConnection } = require('../../db/oracle');

// ─── GET: Member Summary Report ───────────────────────────────────────────────
async function getMembersReport() {
  let conn;
  try {
    conn = await getConnection();

    const summary = await conn.execute(
      `SELECT
         COUNT(*) AS TOTAL_STUDENTS,
         SUM(CASE WHEN ACCOUNT_STATUS = 'active'   THEN 1 ELSE 0 END) AS ACTIVE,
         SUM(CASE WHEN ACCOUNT_STATUS = 'blocked'  THEN 1 ELSE 0 END) AS BLOCKED,
         SUM(CASE WHEN ACCOUNT_STATUS = 'pending'  THEN 1 ELSE 0 END) AS PENDING,
         SUM(CASE WHEN ACCOUNT_STATUS = 'verified' THEN 1 ELSE 0 END) AS VERIFIED
       FROM STUDENT`
    );

    // Registrations over the last 12 months
    const monthly = await conn.execute(
      `SELECT TO_CHAR(CREATED_AT, 'YYYY-MM') AS MONTH, COUNT(*) AS REGISTRATIONS
       FROM STUDENT
       WHERE CREATED_AT >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -11)
       GROUP BY TO_CHAR(CREATED_AT, 'YYYY-MM')
       ORDER BY MONTH`
    );

    return {
      report: 'members_summary',
      generatedAt: new Date().toISOString(),
      summary: summary.rows[0],
      monthlyRegistrations: monthly.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Booking Statistics Report ──────────────────────────────────────────
async function getBookingsReport({ from, to } = {}) {
  let conn;
  try {
    conn = await getConnection();

    // Build conditions based on parameters
    let conditions = [];
    let params = {};
    
    if (from) {
      conditions.push("BOOKING_DATE >= TO_DATE(:dateFrom, 'YYYY-MM-DD')");
      params.dateFrom = from;
    }
    if (to) {
      conditions.push("BOOKING_DATE <= TO_DATE(:dateTo, 'YYYY-MM-DD')");
      params.dateTo = to;
    }
    
    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const summary = await conn.execute(
      `SELECT
         COUNT(*) AS TOTAL_BOOKINGS,
         SUM(CASE WHEN BOOKING_STATUS = 'confirmed'  THEN 1 ELSE 0 END) AS CONFIRMED,
         SUM(CASE WHEN BOOKING_STATUS = 'cancelled'  THEN 1 ELSE 0 END) AS CANCELLED,
         SUM(CASE WHEN BOOKING_STATUS = 'completed'  THEN 1 ELSE 0 END) AS COMPLETED
       FROM BOOKING ${whereClause}`,
      params
    );

    // Most booked equipment
    const joinCond = conditions.length > 0 ? " AND " + conditions.join(" AND ") : "";
    const topEquipment = await conn.execute(
      `SELECT e.EQUIPMENT_NAME,
              COUNT(b.BOOKING_ID) AS TOTAL_BOOKINGS,
              SUM(CASE WHEN b.BOOKING_STATUS = 'cancelled' THEN 1 ELSE 0 END) AS CANCELLATIONS
       FROM BOOKING b
       JOIN EQUIPMENT e ON b.EQUIPMENT_ID = e.EQUIPMENT_ID
       ${whereClause ? whereClause + " AND b.EQUIPMENT_ID = e.EQUIPMENT_ID" : "WHERE b.EQUIPMENT_ID = e.EQUIPMENT_ID"}
       GROUP BY e.EQUIPMENT_NAME
       ORDER BY TOTAL_BOOKINGS DESC
       FETCH FIRST 10 ROWS ONLY`,
      params
    );

    return {
      report: 'bookings_statistics',
      generatedAt: new Date().toISOString(),
      dateRange: { from: from || 'all time', to: to || 'today' },
      summary: summary.rows[0],
      topEquipment: topEquipment.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Payments / Revenue Report ──────────────────────────────────────────
async function getPaymentsReport({ from, to } = {}) {
  let conn;
  try {
    conn = await getConnection();

    // Build where clause based on parameters
    let conditions = [];
    let params = {};
    
    if (from) {
      conditions.push("PAYMENT_DATE >= TO_TIMESTAMP(:dateFrom || ' 00:00:00', 'YYYY-MM-DD HH24:MI:SS')");
      params.dateFrom = from;
    }
    if (to) {
      conditions.push("PAYMENT_DATE <= TO_TIMESTAMP(:dateTo || ' 23:59:59', 'YYYY-MM-DD HH24:MI:SS')");
      params.dateTo = to;
    }
    
    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const summary = await conn.execute(
      `SELECT
         COUNT(*) AS TOTAL_TRANSACTIONS,
         SUM(CASE WHEN PAYMENT_STATUS = 'successful' THEN AMOUNT ELSE 0 END) AS TOTAL_REVENUE,
         COUNT(CASE WHEN PAYMENT_STATUS = 'successful' THEN 1 END) AS SUCCESSFUL,
         COUNT(CASE WHEN PAYMENT_STATUS = 'failed'    THEN 1 END) AS FAILED,
         COUNT(CASE WHEN PAYMENT_STATUS = 'pending'   THEN 1 END) AS PENDING,
         COUNT(CASE WHEN PAYMENT_STATUS = 'refunded'  THEN 1 END) AS REFUNDED
       FROM PAYMENT ${whereClause}`,
      params
    );

    // Monthly revenue
    const monthly = await conn.execute(
      `SELECT TO_CHAR(PAYMENT_DATE, 'YYYY-MM') AS MONTH,
              SUM(CASE WHEN PAYMENT_STATUS = 'successful' THEN AMOUNT ELSE 0 END) AS REVENUE,
              COUNT(CASE WHEN PAYMENT_STATUS = 'successful' THEN 1 END) AS SUCCESSFUL_PAYMENTS
       FROM PAYMENT
       WHERE PAYMENT_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -11)
       GROUP BY TO_CHAR(PAYMENT_DATE, 'YYYY-MM')
       ORDER BY MONTH`
    );

    return {
      report: 'payments_revenue',
      generatedAt: new Date().toISOString(),
      currency: 'BWP',
      dateRange: { from: from || 'all time', to: to || 'today' },
      summary: summary.rows[0],
      monthlyRevenue: monthly.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Expiring Memberships Report ────────────────────────────────────────
async function getExpiringMembershipsReport({ days = 60 } = {}) {
  let conn;
  try {
    conn = await getConnection();

    const result = await conn.execute(
      `SELECT s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME, s.EMAIL,
              m.MEMBERSHIP_NUMBER, m.STATUS,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS END_DATE,
              TRUNC(m.END_DATE - SYSDATE) AS DAYS_UNTIL_EXPIRY
       FROM MEMBERSHIP m
       JOIN STUDENT s ON m.STUDENT_ID = s.STUDENT_ID
       WHERE m.STATUS = 'active'
         AND m.END_DATE BETWEEN SYSDATE AND SYSDATE + :days
       ORDER BY m.END_DATE ASC`,
      { days: parseInt(days) }
    );

    return {
      report: 'expiring_memberships',
      generatedAt: new Date().toISOString(),
      windowDays: days,
      total: result.rows.length,
      members: result.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Financial Summary Report ───────────────────────────────────────────
async function getFinancialSummary() {
  let conn;
  try {
    conn = await getConnection();

    const revenue = await conn.execute(
      `SELECT
         SUM(CASE WHEN PAYMENT_STATUS = 'successful' THEN AMOUNT ELSE 0 END) AS TOTAL_REVENUE,
         COUNT(CASE WHEN PAYMENT_STATUS = 'successful' THEN 1 END) AS PAID_MEMBERS,
         COUNT(CASE WHEN PAYMENT_STATUS = 'pending' THEN 1 END) AS PENDING_PAYMENTS,
         COUNT(CASE WHEN PAYMENT_STATUS = 'failed'  THEN 1 END) AS FAILED_PAYMENTS,
         SUM(CASE WHEN PAYMENT_STATUS = 'refunded' THEN AMOUNT ELSE 0 END) AS TOTAL_REFUNDED
       FROM PAYMENT`
    );

    const monthly = await conn.execute(
      `SELECT TO_CHAR(PAYMENT_DATE, 'YYYY-MM') AS MONTH,
              SUM(CASE WHEN PAYMENT_STATUS = 'successful' THEN AMOUNT ELSE 0 END) AS REVENUE
       FROM PAYMENT
       WHERE PAYMENT_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -11)
       GROUP BY TO_CHAR(PAYMENT_DATE, 'YYYY-MM')
       ORDER BY MONTH`
    );

    return {
      report: 'financial_summary',
      generatedAt: new Date().toISOString(),
      currency: 'BWP',
      membershipFee: 100.00,
      summary: revenue.rows[0],
      monthlyRevenue: monthly.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Audit Report ────────────────────────────────────────────────────────
async function getAuditReport({ page = 1, limit = 50 } = {}) {
  let conn;
  try {
    conn = await getConnection();
    const offset = (page - 1) * limit;

    const countResult = await conn.execute(
      `SELECT COUNT(*) AS TOTAL FROM NOTIFICATION`
    );
    const total = countResult.rows[0].TOTAL;

    const result = await conn.execute(
      `SELECT n.NOTIFICATION_ID, n.STUDENT_ID, n.NOTIFICATION_TYPE,
              n.RECIPIENT_EMAIL, n.DELIVERY_STATUS,
              TO_CHAR(n.SEND_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS SEND_DATE,
              s.FIRST_NAME, s.LAST_NAME
       FROM NOTIFICATION n
       LEFT JOIN STUDENT s ON n.STUDENT_ID = s.STUDENT_ID
       ORDER BY n.NOTIFICATION_ID DESC
       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      {}
    );

    return {
      report: 'audit_log',
      generatedAt: new Date().toISOString(),
      total,
      page,
      limit,
      entries: result.rows
    };
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = {
  getMembersReport,
  getBookingsReport,
  getPaymentsReport,
  getFinancialSummary,
  getAuditReport,
  getExpiringMembershipsReport
};
