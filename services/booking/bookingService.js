// services/booking/bookingService.js
const oracledb = require('oracledb');
const { getConnection } = require('../../db/oracle');
const emailService = require('../notification/emailService');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── GET: List All Equipment ──────────────────────────────────────────────────
async function getAllEquipment({ status } = {}) {
  let conn;
  try {
    conn = await getConnection();
    const sql = status
      ? `SELECT EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS,
                TO_CHAR(CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
         FROM EQUIPMENT WHERE AVAILABILITY_STATUS = :status ORDER BY EQUIPMENT_NAME`
      : `SELECT EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS,
                TO_CHAR(CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
         FROM EQUIPMENT ORDER BY EQUIPMENT_NAME`;
    const result = await conn.execute(sql, status ? { status } : {}, {
      fetchInfo: { DESCRIPTION: { type: oracledb.STRING } }
    });
    return {
      equipment: result.rows.map(r => ({
        EQUIPMENT_ID: r.EQUIPMENT_ID,
        EQUIPMENT_NAME: r.EQUIPMENT_NAME,
        DESCRIPTION: r.DESCRIPTION,
        AVAILABILITY_STATUS: r.AVAILABILITY_STATUS,
        CREATED_AT: r.CREATED_AT
      }))
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Equipment Availability for a Date ───────────────────────────────────
async function getEquipmentAvailability(equipmentId, date) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT START_TIME, END_TIME, BOOKING_STATUS
       FROM BOOKING
       WHERE EQUIPMENT_ID = :eid
         AND BOOKING_DATE = TO_DATE(:bd, 'YYYY-MM-DD')
         AND BOOKING_STATUS != 'cancelled'
       ORDER BY START_TIME`,
      { eid: equipmentId, bd: date }
    );
    return result.rows.map(r => ({
      START_TIME: r.START_TIME,
      END_TIME: r.END_TIME,
      BOOKING_STATUS: r.BOOKING_STATUS
    }));
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Equipment by ID ─────────────────────────────────────────────────────
async function getEquipmentById(equipmentId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS,
              TO_CHAR(CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
       FROM EQUIPMENT WHERE EQUIPMENT_ID = :id`,
      { id: equipmentId }
    );
    if (result.rows.length === 0) {
      throw appError('Equipment not found.', 404, 'NOT_FOUND');
    }
    return { equipment: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: List Bookings ───────────────────────────────────────────────────────
async function getBookings({ studentId, role, status, date, page = 1, limit = 20 }) {
  let conn;
  try {
    conn = await getConnection();
    const offset = (page - 1) * limit;
    const isAdmin = role === 'admin';
    const params = { stat: status || null, filterDate: date || null };
    let whereClause = `WHERE (:stat IS NULL OR b.BOOKING_STATUS = :stat)
                         AND (:filterDate IS NULL OR b.BOOKING_DATE = TO_DATE(:filterDate, 'YYYY-MM-DD'))`;
    if (!isAdmin) {
      params.sid = studentId;
      whereClause += ` AND b.STUDENT_ID = :sid`;
    }
    const countSql = `SELECT COUNT(*) AS TOTAL FROM BOOKING b ${whereClause}`;
    const countResult = await conn.execute(countSql, params);
    const total = countResult.rows[0].TOTAL;
    const sql = `SELECT b.BOOKING_ID, b.STUDENT_ID, b.EQUIPMENT_ID,
                    TO_CHAR(b.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
                    b.START_TIME, b.END_TIME, b.BOOKING_STATUS,
                    TO_CHAR(b.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT,
                    e.EQUIPMENT_NAME${isAdmin ? `, s.FIRST_NAME, s.LAST_NAME, s.EMAIL` : ''}
             FROM BOOKING b
             JOIN EQUIPMENT e ON b.EQUIPMENT_ID = e.EQUIPMENT_ID
             ${isAdmin ? `JOIN STUDENT s ON b.STUDENT_ID = s.STUDENT_ID` : ''}
             ${whereClause}
             ORDER BY b.BOOKING_DATE DESC, b.START_TIME DESC
             OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    const result = await conn.execute(sql, params);
    return { total, page, limit, pages: Math.ceil(total / limit), bookings: result.rows };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Booking by ID ───────────────────────────────────────────────────────
async function getBookingById(bookingId, studentId, role) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT b.BOOKING_ID, b.STUDENT_ID, b.EQUIPMENT_ID,
              TO_CHAR(b.BOOKING_DATE, 'YYYY-MM-DD') AS BOOKING_DATE,
              b.START_TIME, b.END_TIME, b.BOOKING_STATUS,
              TO_CHAR(b.CREATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_AT,
              e.EQUIPMENT_NAME, e.DESCRIPTION,
              s.FIRST_NAME, s.LAST_NAME
       FROM BOOKING b
       JOIN EQUIPMENT e ON b.EQUIPMENT_ID = e.EQUIPMENT_ID
       JOIN STUDENT s ON b.STUDENT_ID = s.STUDENT_ID
       WHERE b.BOOKING_ID = :bid`,
      { bid: bookingId }
    );
    if (result.rows.length === 0) {
      throw appError('Booking not found.', 404, 'NOT_FOUND');
    }
    const booking = result.rows[0];
    if (role !== 'admin' && booking.STUDENT_ID !== studentId) {
      throw appError('Access denied.', 403, 'FORBIDDEN');
    }
    return { booking };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Create Booking ─────────────────────────────────────────────────────
async function createBooking(data) {
  const { studentId, equipmentId, bookingDate, startTime, endTime } = data;
  let conn;
  try {
    conn = await getConnection();
    const eqResult = await conn.execute(
      `SELECT EQUIPMENT_ID, EQUIPMENT_NAME, AVAILABILITY_STATUS FROM EQUIPMENT WHERE EQUIPMENT_ID = :id`,
      { id: equipmentId }
    );
    if (eqResult.rows.length === 0) {
      throw appError('Equipment not found.', 404, 'NOT_FOUND');
    }
    if (eqResult.rows[0].AVAILABILITY_STATUS !== 'available') {
      throw appError('This equipment is currently unavailable.', 409, 'EQUIPMENT_UNAVAILABLE');
    }
    const overlapResult = await conn.execute(
      `SELECT BOOKING_ID FROM BOOKING
       WHERE EQUIPMENT_ID = :eid
         AND BOOKING_DATE = TO_DATE(:bd, 'YYYY-MM-DD')
         AND BOOKING_STATUS != 'cancelled'
         AND (START_TIME < :et AND END_TIME > :st)`,
      { eid: equipmentId, bd: bookingDate, st: startTime, et: endTime }
    );
    if (overlapResult.rows.length > 0) {
      throw appError('This time slot overlaps with an existing booking.', 409, 'BOOKING_OVERLAP');
    }
    await conn.execute(
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE, START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING), :sid, :eid, TO_DATE(:bd, 'YYYY-MM-DD'), :st, :et, 'confirmed')`,
      { sid: studentId, eid: equipmentId, bd: bookingDate, st: startTime, et: endTime }
    );
    const newBooking = await conn.execute(`SELECT MAX(BOOKING_ID) AS BID FROM BOOKING`);
    const bookingId = newBooking.rows[0].BID;
    await conn.commit();
    const studentResult = await conn.execute(`SELECT EMAIL, FIRST_NAME FROM STUDENT WHERE STUDENT_ID = :sid`, { sid: studentId });
    if (studentResult.rows.length > 0) {
      const student = studentResult.rows[0];
      await conn.execute(
        `INSERT INTO NOTIFICATION (NOTIFICATION_ID, STUDENT_ID, NOTIFICATION_TYPE, MESSAGE, RECIPIENT_EMAIL, SEND_DATE, DELIVERY_STATUS)
         VALUES ((SELECT NVL(MAX(NOTIFICATION_ID),0)+1 FROM NOTIFICATION), :sid, 'booking_reminder', :msg, :email, TO_TIMESTAMP(:bd || ' ' || :st, 'YYYY-MM-DD HH24:MI') - INTERVAL '2' HOUR, 'scheduled')`,
        { sid: studentId, msg: `Reminder: ${eqResult.rows[0].EQUIPMENT_NAME} booking on ${bookingDate} at ${startTime}`, email: student.EMAIL, bd: bookingDate, st: startTime }
      );
      await conn.commit();
    }
    return { message: 'Booking confirmed. A reminder will be sent 2 hours before your booking.', bookingId, equipmentName: eqResult.rows[0].EQUIPMENT_NAME, bookingDate, startTime, endTime };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── PATCH: Cancel Booking ────────────────────────────────────────────────────
async function cancelBooking(bookingId, requestingStudentId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`SELECT BOOKING_ID, STUDENT_ID, BOOKING_DATE, START_TIME, BOOKING_STATUS FROM BOOKING WHERE BOOKING_ID = :id`, { id: bookingId });
    if (result.rows.length === 0) {
      throw appError('Booking not found.', 404, 'NOT_FOUND');
    }
    const booking = result.rows[0];
    if (requestingStudentId && booking.STUDENT_ID !== requestingStudentId) {
      throw appError('You can only cancel your own bookings.', 403, 'FORBIDDEN');
    }
    if (booking.BOOKING_STATUS === 'cancelled') {
      throw appError('Booking is already cancelled.', 400, 'ALREADY_CANCELLED');
    }
    await conn.execute(`UPDATE BOOKING SET BOOKING_STATUS = 'cancelled' WHERE BOOKING_ID = :id`, { id: bookingId });
    await conn.execute(`UPDATE NOTIFICATION SET DELIVERY_STATUS = 'pending' WHERE STUDENT_ID = :sid AND NOTIFICATION_TYPE = 'booking_reminder' AND DELIVERY_STATUS = 'scheduled'`, { sid: booking.STUDENT_ID });
    await conn.commit();
    return { message: `Booking ${bookingId} has been cancelled.` };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Booking (Admin) ───────────────────────────────────────────
async function deleteBooking(bookingId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`DELETE FROM BOOKING WHERE BOOKING_ID = :id`, { id: bookingId });
    if (result.rowsAffected === 0) {
      throw appError('Booking not found.', 404, 'NOT_FOUND');
    }
    await conn.commit();
    return { message: 'Booking deleted successfully.', bookingId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Add New Equipment (Admin) ───────────────────────────────────────────
async function createEquipment({ equipmentName, description, availabilityStatus = 'available' }) {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES ((SELECT NVL(MAX(EQUIPMENT_ID),0)+1 FROM EQUIPMENT), :name, :descr, :stat)`,
      { name: equipmentName, descr: description, stat: availabilityStatus }
    );
    await conn.commit();
    const result = await conn.execute(`SELECT MAX(EQUIPMENT_ID) AS ID FROM EQUIPMENT`);
    return { message: 'Equipment added successfully.', equipmentId: result.rows[0].ID, equipmentName, availabilityStatus };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── PUT: Update Equipment (Admin) ─────────────────────────────────────────────
async function updateEquipment(equipmentId, { equipmentName, description, availabilityStatus }) {
  let conn;
  try {
    conn = await getConnection();
    const updates = [];
    const params = { eid: equipmentId };
    if (equipmentName) { updates.push('EQUIPMENT_NAME = :name'); params.name = equipmentName; }
    if (description) { updates.push('DESCRIPTION = :desc'); params.desc = description; }
    if (availabilityStatus) { updates.push('AVAILABILITY_STATUS = :stat'); params.stat = availabilityStatus; }
    if (updates.length === 0) throw appError('No fields to update.', 400, 'NO_FIELDS');
    const result = await conn.execute(`UPDATE EQUIPMENT SET ${updates.join(', ')} WHERE EQUIPMENT_ID = :eid`, params);
    if (result.rowsAffected === 0) throw appError('Equipment not found.', 404, 'NOT_FOUND');
    await conn.commit();
    return { message: 'Equipment updated successfully.', equipmentId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Equipment (Admin) ───────────────────────────────────────────
async function deleteEquipment(equipmentId) {
  let conn;
  try {
    conn = await getConnection();
    const check = await conn.execute(`SELECT COUNT(*) AS CNT FROM BOOKING WHERE EQUIPMENT_ID = :eid AND BOOKING_STATUS IN ('confirmed', 'pending')`, { eid: equipmentId });
    if (check.rows[0].CNT > 0) throw appError('Cannot delete equipment with active bookings.', 400, 'HAS_ACTIVE_BOOKINGS');
    const result = await conn.execute(`DELETE FROM EQUIPMENT WHERE EQUIPMENT_ID = :eid`, { eid: equipmentId });
    if (result.rowsAffected === 0) throw appError('Equipment not found.', 404, 'NOT_FOUND');
    await conn.commit();
    return { message: 'Equipment deleted successfully.', equipmentId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = {
  getAllEquipment,
  getEquipmentById,
  getEquipmentAvailability,
  getBookings,
  getBookingById,
  createBooking,
  cancelBooking,
  deleteBooking,
  createEquipment,
  updateEquipment,
  deleteEquipment
};