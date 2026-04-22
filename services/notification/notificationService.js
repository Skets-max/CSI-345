// services/notification/notificationService.js
const { getConnection } = require('../../db/oracle');
const emailService = require('./emailService');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── GET: List Notifications (admin) ─────────────────────────────────────────
async function getAllNotifications({ type, deliveryStatus, studentId, page = 1, limit = 20 } = {}) {
  let conn;
  try {
    conn = await getConnection();
    const offset = (page - 1) * limit;

    const params = {
      typ: type || null,
      stat: deliveryStatus || null,
      sid: studentId || null
    };

    const countResult = await conn.execute(
      `SELECT COUNT(*) AS TOTAL FROM NOTIFICATION n
       WHERE (:typ IS NULL OR n.NOTIFICATION_TYPE = :typ)
         AND (:stat IS NULL OR n.DELIVERY_STATUS = :stat)
         AND (:sid IS NULL OR n.STUDENT_ID = :sid)`,
      params
    );
    const total = countResult.rows[0].TOTAL;

    const result = await conn.execute(
      `SELECT n.NOTIFICATION_ID, n.STUDENT_ID, n.NOTIFICATION_TYPE,
              n.RECIPIENT_EMAIL, n.DELIVERY_STATUS,
              TO_CHAR(n.SEND_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS SEND_DATE,
              s.FIRST_NAME, s.LAST_NAME
       FROM NOTIFICATION n
       LEFT JOIN STUDENT s ON n.STUDENT_ID = s.STUDENT_ID
       WHERE (:typ IS NULL OR n.NOTIFICATION_TYPE = :typ)
         AND (:stat IS NULL OR n.DELIVERY_STATUS = :stat)
         AND (:sid IS NULL OR n.STUDENT_ID = :sid)
       ORDER BY n.SEND_DATE DESC NULLS LAST, n.NOTIFICATION_ID DESC
       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      params
    );

    return { total, page, limit, pages: Math.ceil(total / limit), notifications: result.rows };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Notification by ID ──────────────────────────────────────────────────
async function getNotificationById(notificationId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT n.NOTIFICATION_ID, n.STUDENT_ID, n.NOTIFICATION_TYPE,
              DBMS_LOB.SUBSTR(n.MESSAGE, 4000, 1) AS MESSAGE,
              n.RECIPIENT_EMAIL, n.DELIVERY_STATUS,
              TO_CHAR(n.SEND_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS SEND_DATE,
              s.FIRST_NAME, s.LAST_NAME, s.EMAIL
       FROM NOTIFICATION n
       LEFT JOIN STUDENT s ON n.STUDENT_ID = s.STUDENT_ID
       WHERE n.NOTIFICATION_ID = :id`,
      { id: notificationId }
    );
    if (result.rows.length === 0) {
      throw appError('Notification not found.', 404, 'NOT_FOUND');
    }
    return { notification: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Send Notification ──────────────────────────────────────────────────
async function sendNotification(data) {
  const { studentId, notificationType, recipientEmail } = data;
  let conn;
  try {
    conn = await getConnection();

    // Determine email content based on type
    let subject, html;
    switch (notificationType) {
      case 'membership_renewal_reminder': {
        const memberResult = await conn.execute(
          `SELECT s.FIRST_NAME, TO_CHAR(m.END_DATE, 'DD Mon YYYY') AS END_DATE
           FROM STUDENT s
           JOIN MEMBERSHIP m ON s.STUDENT_ID = m.STUDENT_ID
           WHERE s.STUDENT_ID = :sid AND m.STATUS = 'active'
           FETCH FIRST 1 ROW ONLY`,
          { sid: studentId }
        );
        if (memberResult.rows.length === 0) throw appError('Active membership not found.', 404, 'NOT_FOUND');
        const tpl = emailService.membershipRenewalReminderEmail(
          memberResult.rows[0].FIRST_NAME,
          memberResult.rows[0].END_DATE
        );
        subject = tpl.subject; html = tpl.html;
        break;
      }
      default:
        subject = `Club Notification: ${notificationType}`;
        html = `<p>You have a new notification from the Student Club Portal.</p>`;
    }

    // Insert notification record
    await conn.execute(
      `INSERT INTO NOTIFICATION (NOTIFICATION_ID, STUDENT_ID, NOTIFICATION_TYPE,
                                 MESSAGE, RECIPIENT_EMAIL, SEND_DATE, DELIVERY_STATUS)
       VALUES ((SELECT NVL(MAX(NOTIFICATION_ID),0)+1 FROM NOTIFICATION), :sid, :type, :msg, :email, SYSTIMESTAMP, 'pending')`,
      { sid: studentId, type: notificationType, msg: html, email: recipientEmail }
    );
    const idResult = await conn.execute(`SELECT MAX(NOTIFICATION_ID) AS NID FROM NOTIFICATION`);
    const notificationId = idResult.rows[0].NID;

    // Send email
    await emailService.sendEmail({ to: recipientEmail, subject, html });

    // Mark as sent
    await conn.execute(
      `UPDATE NOTIFICATION SET DELIVERY_STATUS = 'sent' WHERE NOTIFICATION_ID = :nid`,
      { nid: notificationId }
    );
    await conn.commit();

    return { message: 'Notification sent successfully.', notificationId };
  } catch (err) {
    if (conn) {
      await conn.execute(
        `UPDATE NOTIFICATION SET DELIVERY_STATUS = 'failed'
         WHERE NOTIFICATION_ID = (SELECT MAX(NOTIFICATION_ID) FROM NOTIFICATION WHERE STUDENT_ID = :sid)`,
        { sid: data.studentId }
      ).catch(() => {});
      await conn.rollback();
    }
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Retry Failed Notification ─────────────────────────────────────────
async function retryNotification(notificationId) {
  let conn;
  try {
    conn = await getConnection();

    const result = await conn.execute(
      `SELECT n.NOTIFICATION_ID, n.RECIPIENT_EMAIL, n.NOTIFICATION_TYPE,
              DBMS_LOB.SUBSTR(n.MESSAGE, 4000, 1) AS MESSAGE, n.DELIVERY_STATUS
       FROM NOTIFICATION n WHERE n.NOTIFICATION_ID = :id`,
      { id: notificationId }
    );
    if (result.rows.length === 0) {
      throw appError('Notification not found.', 404, 'NOT_FOUND');
    }

    const notif = result.rows[0];
    if (notif.DELIVERY_STATUS !== 'failed') {
      throw appError('Only failed notifications can be retried.', 400, 'INVALID_STATUS');
    }

    await emailService.sendEmail({
      to: notif.RECIPIENT_EMAIL,
      subject: `Club Notification: ${notif.NOTIFICATION_TYPE}`,
      html: notif.MESSAGE || '<p>Club Portal Notification</p>'
    });

    await conn.execute(
      `UPDATE NOTIFICATION SET DELIVERY_STATUS = 'sent', SEND_DATE = SYSTIMESTAMP
       WHERE NOTIFICATION_ID = :id`,
      { id: notificationId }
    );
    await conn.commit();

    return { message: 'Notification resent successfully.', notificationId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Notification (Admin) ───────────────────────────────────────
async function deleteNotification(notificationId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`DELETE FROM NOTIFICATION WHERE NOTIFICATION_ID = :id`, { id: notificationId });
    if (result.rowsAffected === 0) {
      throw appError('Notification not found.', 404, 'NOT_FOUND');
    }
    await conn.commit();
    return { message: 'Notification deleted successfully.', notificationId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = { getAllNotifications, getNotificationById, sendNotification, retryNotification, deleteNotification };
