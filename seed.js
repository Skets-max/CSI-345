// seed.js – Full test data for all tables
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initPool, getConnection, closePool } = require('./db/oracle');

async function run(conn, sql, params, label) {
  try {
    await conn.execute(sql, params || {});
    console.log(`✅ ${label}`);
  } catch (err) {
    if (err.message.includes('ORA-00955') || err.message.includes('ORA-00001') ||
        err.message.includes('already exists') || err.message.includes('unique constraint')) {
      console.log(`⚠️  ${label} – already exists, skipping`);
    } else {
      console.error(`❌ ${label}: ${err.message}`);
    }
  }
}

async function seed() {
  await initPool();
  const conn = await getConnection();

  try {
    const hash = await bcrypt.hash('SecurePass1', 12);

    console.log('\n=== SEEDING DATABASE ===\n');

    // ── 1. STUDENTS ──────────────────────────────────────────────
    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, PHONE_NUMBER, ACCOUNT_STATUS)
       VALUES ('202204203', 'Marang', 'Ponatshego', TO_DATE('2000-05-15','YYYY-MM-DD'),
               '202204203@student.university.ac.bw', :pw, '+26771234567', 'active')`,
      { pw: hash }, 'Student: Marang'
    );

    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, PHONE_NUMBER, ACCOUNT_STATUS)
       VALUES ('202204204', 'Thabo', 'Moeti', TO_DATE('2001-03-22','YYYY-MM-DD'),
               '202204204@student.university.ac.bw', :pw, '+26772345678', 'active')`,
      { pw: hash }, 'Student: Thabo'
    );

    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, PHONE_NUMBER, ACCOUNT_STATUS)
       VALUES ('202204205', 'Lesedi', 'Kgosi', TO_DATE('1999-11-08','YYYY-MM-DD'),
               '202204205@student.university.ac.bw', :pw, '+26773456789', 'active')`,
      { pw: hash }, 'Student: Lesedi'
    );

    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, PHONE_NUMBER, ACCOUNT_STATUS)
       VALUES ('202204206', 'Kabo', 'Mogae', TO_DATE('2002-07-30','YYYY-MM-DD'),
               '202204206@student.university.ac.bw', :pw, '+26774567890', 'verified')`,
      { pw: hash }, 'Student: Kabo (verified)'
    );

    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, PHONE_NUMBER, ACCOUNT_STATUS)
       VALUES ('202204207', 'Neo', 'Dithapo', TO_DATE('2001-01-12','YYYY-MM-DD'),
               '202204207@student.university.ac.bw', :pw, '+26775678901', 'pending')`,
      { pw: hash }, 'Student: Neo (pending)'
    );

    await run(conn,
      `INSERT INTO STUDENT (STUDENT_ID, FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, EMAIL, PASSWORD_HASH, ACCOUNT_STATUS)
       VALUES ('ADMIN001', 'Club', 'Administrator', TO_DATE('1990-01-01','YYYY-MM-DD'),
               'admin@university.ac.bw', :pw, 'active')`,
      { pw: hash }, 'Student: Admin'
    );

    // ── 2. VERIFICATION TOKENS ───────────────────────────────────
    await run(conn,
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT, IS_USED)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN),
               '202204206', 'tok-verify-kabo-001', 'email_verification',
               SYSTIMESTAMP + INTERVAL '24' HOUR, 0)`,
      {}, 'Token: email_verification for Kabo'
    );

    await run(conn,
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT, IS_USED)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN),
               '202204207', 'tok-verify-neo-001', 'email_verification',
               SYSTIMESTAMP + INTERVAL '24' HOUR, 0)`,
      {}, 'Token: email_verification for Neo'
    );

    await run(conn,
      `INSERT INTO VERIFICATION_TOKEN (TOKEN_ID, STUDENT_ID, TOKEN_VALUE, TOKEN_TYPE, EXPIRES_AT, IS_USED)
       VALUES ((SELECT NVL(MAX(TOKEN_ID),0)+1 FROM VERIFICATION_TOKEN),
               '202204205', 'tok-renewal-lesedi-001', 'password_reset',
               SYSTIMESTAMP + INTERVAL '48' HOUR, 0)`,
      {}, 'Token: renewal for Lesedi'
    );

    // ── 3. EQUIPMENT ─────────────────────────────────────────────
    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (1, 'Tennis Racket', '4 x Wilson Pro Staff rackets available', 'available')`,
      {}, 'Equipment: Tennis Racket'
    );

    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (2, 'Football', 'Size 5 match footballs', 'available')`,
      {}, 'Equipment: Football'
    );

    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (3, 'Badminton Set', 'Full badminton set including net and rackets', 'available')`,
      {}, 'Equipment: Badminton Set'
    );

    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (4, 'Basketball', 'Spalding NBA official ball', 'available')`,
      {}, 'Equipment: Basketball'
    );

    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (5, 'Volleyball', 'Official size and weight', 'available')`,
      {}, 'Equipment: Volleyball'
    );

    await run(conn,
      `INSERT INTO EQUIPMENT (EQUIPMENT_ID, EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS)
       VALUES (6, 'Cricket Bat', 'Willow cricket bat', 'maintenance')`,
      {}, 'Equipment: Cricket Bat (maintenance)'
    );

    // ── 4. PAYMENTS ──────────────────────────────────────────────
    await run(conn,
      `INSERT INTO PAYMENT (PAYMENT_ID, STUDENT_ID, AMOUNT, PAYMENT_STATUS, TRANSACTION_REFERENCE)
       VALUES ((SELECT NVL(MAX(PAYMENT_ID),0)+1 FROM PAYMENT),
               '202204203', 100.00, 'successful', 'pi_marang_001')`,
      {}, 'Payment: Marang #1'
    );

    await run(conn,
      `INSERT INTO PAYMENT (PAYMENT_ID, STUDENT_ID, AMOUNT, PAYMENT_STATUS, TRANSACTION_REFERENCE)
       VALUES ((SELECT NVL(MAX(PAYMENT_ID),0)+1 FROM PAYMENT),
               '202204203', 100.00, 'successful', 'pi_marang_002')`,
      {}, 'Payment: Marang #2 (2nd membership)'
    );

    await run(conn,
      `INSERT INTO PAYMENT (PAYMENT_ID, STUDENT_ID, AMOUNT, PAYMENT_STATUS, TRANSACTION_REFERENCE)
       VALUES ((SELECT NVL(MAX(PAYMENT_ID),0)+1 FROM PAYMENT),
               '202204204', 100.00, 'successful', 'pi_thabo_001')`,
      {}, 'Payment: Thabo'
    );

    await run(conn,
      `INSERT INTO PAYMENT (PAYMENT_ID, STUDENT_ID, AMOUNT, PAYMENT_STATUS, TRANSACTION_REFERENCE)
       VALUES ((SELECT NVL(MAX(PAYMENT_ID),0)+1 FROM PAYMENT),
               '202204205', 100.00, 'failed', 'pi_lesedi_failed')`,
      {}, 'Payment: Lesedi (failed)'
    );

    // ── 5. MEMBERSHIPS ───────────────────────────────────────────
    await run(conn,
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, PAYMENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP),
               '202204203', 1, 'CLB-202204203-001',
               TO_DATE('2026-01-01','YYYY-MM-DD'), TO_DATE('2027-01-01','YYYY-MM-DD'), 'active')`,
      {}, 'Membership: Marang #1 (active)'
    );

    await run(conn,
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, PAYMENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP),
               '202204203', 2, 'CLB-202204203-002',
               TO_DATE('2026-04-01','YYYY-MM-DD'), TO_DATE('2027-04-01','YYYY-MM-DD'), 'active')`,
      {}, 'Membership: Marang #2 (active - 2nd membership)'
    );

    await run(conn,
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, PAYMENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP),
               '202204204', 3, 'CLB-202204204-001',
               TO_DATE('2026-01-01','YYYY-MM-DD'), TO_DATE('2026-06-01','YYYY-MM-DD'), 'active')`,
      {}, 'Membership: Thabo (expiring soon)'
    );

    await run(conn,
      `INSERT INTO MEMBERSHIP (MEMBERSHIP_ID, STUDENT_ID, PAYMENT_ID, MEMBERSHIP_NUMBER,
                               START_DATE, END_DATE, STATUS)
       VALUES ((SELECT NVL(MAX(MEMBERSHIP_ID),0)+1 FROM MEMBERSHIP),
               '202204205', 4, 'CLB-202204205-001',
               TO_DATE('2024-01-01','YYYY-MM-DD'), TO_DATE('2025-01-01','YYYY-MM-DD'), 'expired')`,
      {}, 'Membership: Lesedi (expired)'
    );

    // ── 6. MEMBERSHIP CARDS ──────────────────────────────────────
    await run(conn,
      `INSERT INTO MEMBERSHIP_CARD (CARD_ID, MEMBERSHIP_ID, CARD_NUMBER, QR_CODE_DATA)
       VALUES ((SELECT NVL(MAX(CARD_ID),0)+1 FROM MEMBERSHIP_CARD),
               1, 'CARD-202204203-001',
               '{"cardNumber":"CARD-202204203-001","studentId":"202204203","membershipNumber":"CLB-202204203-001","validUntil":"2027-01-01"}')`,
      {}, 'Card: Marang #1'
    );

    await run(conn,
      `INSERT INTO MEMBERSHIP_CARD (CARD_ID, MEMBERSHIP_ID, CARD_NUMBER, QR_CODE_DATA)
       VALUES ((SELECT NVL(MAX(CARD_ID),0)+1 FROM MEMBERSHIP_CARD),
               2, 'CARD-202204203-002',
               '{"cardNumber":"CARD-202204203-002","studentId":"202204203","membershipNumber":"CLB-202204203-002","validUntil":"2027-04-01"}')`,
      {}, 'Card: Marang #2'
    );

    await run(conn,
      `INSERT INTO MEMBERSHIP_CARD (CARD_ID, MEMBERSHIP_ID, CARD_NUMBER, QR_CODE_DATA)
       VALUES ((SELECT NVL(MAX(CARD_ID),0)+1 FROM MEMBERSHIP_CARD),
               3, 'CARD-202204204-001',
               '{"cardNumber":"CARD-202204204-001","studentId":"202204204","membershipNumber":"CLB-202204204-001","validUntil":"2026-06-01"}')`,
      {}, 'Card: Thabo'
    );

    // ── 7. BOOKINGS ──────────────────────────────────────────────
    await run(conn,
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE,
                            START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING),
               '202204203', 1, TO_DATE('2026-04-15','YYYY-MM-DD'),
               '10:00', '12:00', 'confirmed')`,
      {}, 'Booking: Marang - Tennis Racket'
    );

    await run(conn,
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE,
                            START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING),
               '202204204', 2, TO_DATE('2026-04-15','YYYY-MM-DD'),
               '14:00', '16:00', 'confirmed')`,
      {}, 'Booking: Thabo - Football'
    );

    await run(conn,
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE,
                            START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING),
               '202204203', 3, TO_DATE('2026-04-10','YYYY-MM-DD'),
               '09:00', '11:00', 'completed')`,
      {}, 'Booking: Marang - Badminton (completed)'
    );

    await run(conn,
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE,
                            START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING),
               '202204203', 4, TO_DATE('2026-04-12','YYYY-MM-DD'),
               '13:00', '14:00', 'cancelled')`,
      {}, 'Booking: Marang - Basketball (cancelled)'
    );

    await run(conn,
      `INSERT INTO BOOKING (BOOKING_ID, STUDENT_ID, EQUIPMENT_ID, BOOKING_DATE,
                            START_TIME, END_TIME, BOOKING_STATUS)
       VALUES ((SELECT NVL(MAX(BOOKING_ID),0)+1 FROM BOOKING),
               '202204205', 1, TO_DATE('2026-04-20','YYYY-MM-DD'),
               '15:00', '17:00', 'confirmed')`,
      {}, 'Booking: Lesedi - Tennis Racket'
    );

    // ── 8. NOTIFICATIONS ─────────────────────────────────────────
    await run(conn,
      `INSERT INTO NOTIFICATION (NOTIFICATION_ID, STUDENT_ID, NOTIFICATION_TYPE,
                                 MESSAGE, RECIPIENT_EMAIL, SEND_DATE, DELIVERY_STATUS)
       VALUES ((SELECT NVL(MAX(NOTIFICATION_ID),0)+1 FROM NOTIFICATION),
               '202204203', 'booking_reminder',
               'Reminder: Tennis Racket booking on 2026-04-15 at 10:00',
               '202204203@student.university.ac.bw',
               TO_TIMESTAMP('2026-04-15 08:00:00','YYYY-MM-DD HH24:MI:SS'), 'sent')`,
      {}, 'Notification: booking reminder (sent)'
    );

    await run(conn,
      `INSERT INTO NOTIFICATION (NOTIFICATION_ID, STUDENT_ID, NOTIFICATION_TYPE,
                                 MESSAGE, RECIPIENT_EMAIL, SEND_DATE, DELIVERY_STATUS)
       VALUES ((SELECT NVL(MAX(NOTIFICATION_ID),0)+1 FROM NOTIFICATION),
               '202204204', 'membership_renewal_reminder',
               'Your membership expires on 01 Jun 2026. Please renew.',
               '202204204@student.university.ac.bw',
               SYSTIMESTAMP, 'sent')`,
      {}, 'Notification: renewal reminder (sent)'
    );

    await run(conn,
      `INSERT INTO NOTIFICATION (NOTIFICATION_ID, STUDENT_ID, NOTIFICATION_TYPE,
                                 MESSAGE, RECIPIENT_EMAIL, SEND_DATE, DELIVERY_STATUS)
       VALUES ((SELECT NVL(MAX(NOTIFICATION_ID),0)+1 FROM NOTIFICATION),
               '202204205', 'email_verification',
               'Please verify your email address.',
               '202204205@student.university.ac.bw',
               SYSTIMESTAMP, 'failed')`,
      {}, 'Notification: email verification (failed)'
    );

    await conn.commit();
    console.log('\n✅ All test data seeded successfully!');

  } catch (err) {
    await conn.rollback();
    console.error('❌ Fatal error:', err.message);
  } finally {
    await conn.close();
    await closePool();
  }
}

seed();