// services/payment/paymentService.js
const { getConnection } = require('../../db/oracle');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

const MEMBERSHIP_FEE = 100.00; // BWP 100

// ─── GET: List All Payments (admin) ──────────────────────────────────────────
async function getAllPayments({ status, studentId, page = 1, limit = 20 } = {}) {
  let conn;
  try {
    conn = await getConnection();
    const offset = (page - 1) * limit;

    const params = { stat: status || null, sid: studentId || null };

    const countResult = await conn.execute(
      `SELECT COUNT(*) AS TOTAL FROM PAYMENT p
       WHERE (:stat IS NULL OR p.PAYMENT_STATUS = :stat)
         AND (:sid IS NULL OR p.STUDENT_ID = :sid)`,
      params
    );
    const total = countResult.rows[0].TOTAL;

    const result = await conn.execute(
      `SELECT p.PAYMENT_ID, p.STUDENT_ID, p.AMOUNT,
              TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS PAYMENT_DATE,
              p.PAYMENT_STATUS, p.TRANSACTION_REFERENCE,
              s.FIRST_NAME, s.LAST_NAME, s.EMAIL
       FROM PAYMENT p
       JOIN STUDENT s ON p.STUDENT_ID = s.STUDENT_ID
       WHERE (:stat IS NULL OR p.PAYMENT_STATUS = :stat)
         AND (:sid IS NULL OR p.STUDENT_ID = :sid)
       ORDER BY p.PAYMENT_DATE DESC
       OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      params
    );

    return { total, page, limit, pages: Math.ceil(total / limit), payments: result.rows };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Payment by ID ────────────────────────────────────────────────────────
async function getPaymentById(paymentId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT p.PAYMENT_ID, p.STUDENT_ID, p.AMOUNT,
              TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS PAYMENT_DATE,
              p.PAYMENT_STATUS, p.TRANSACTION_REFERENCE,
              s.FIRST_NAME, s.LAST_NAME, s.EMAIL
       FROM PAYMENT p
       JOIN STUDENT s ON p.STUDENT_ID = s.STUDENT_ID
       WHERE p.PAYMENT_ID = :id`,
      { id: paymentId }
    );
    if (result.rows.length === 0) {
      throw appError('Payment not found.', 404, 'NOT_FOUND');
    }
    return { payment: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Initiate Payment (Stripe Checkout) ────────────────────────────────
async function initiatePayment(studentId, paymentType) {
  let conn;
  try {
    conn = await getConnection();

    // Verify student exists and is verified
    const studentResult = await conn.execute(
      `SELECT STUDENT_ID, FIRST_NAME, LAST_NAME, EMAIL, ACCOUNT_STATUS FROM STUDENT WHERE STUDENT_ID = :id`,
      { id: studentId }
    );
    if (studentResult.rows.length === 0) {
      throw appError('Student not found.', 404, 'NOT_FOUND');
    }
    const student = studentResult.rows[0];
    
    // In development mode, allow payment for pending accounts
    if (process.env.NODE_ENV !== 'development') {
      if (!['verified', 'active'].includes(student.ACCOUNT_STATUS)) {
        throw appError('Account must be email-verified before payment.', 400, 'ACCOUNT_NOT_VERIFIED');
      }
    }

    // Create a pending payment record (with unique pending transaction ref)
    const pendingTxnRef = `pending_${studentId}_${Date.now()}`;
    await conn.execute(
      `INSERT INTO PAYMENT (PAYMENT_ID, STUDENT_ID, AMOUNT, PAYMENT_STATUS, TRANSACTION_REFERENCE)
       VALUES ((SELECT NVL(MAX(PAYMENT_ID),0)+1 FROM PAYMENT), :sid, :amount, 'pending', :ref)`,
      { sid: studentId, amount: MEMBERSHIP_FEE, ref: pendingTxnRef }
    );
    const paymentIdResult = await conn.execute(`SELECT MAX(PAYMENT_ID) AS PID FROM PAYMENT`);
    const paymentId = paymentIdResult.rows[0].PID;
    await conn.commit();

    // Check if Stripe key is configured
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || stripeKey.startsWith('sk_test_') && stripeKey === 'sk_test_xxx') {
      // Development mode without real Stripe - simulate payment
      console.log(`[DEV] Simulating payment for student ${studentId}, payment ID ${paymentId}`);
      
      // Auto-mark as successful for testing
      const txnRef = `dev_${studentId}_${Date.now()}`;
      await conn.execute(
        `UPDATE PAYMENT SET PAYMENT_STATUS = 'successful', TRANSACTION_REFERENCE = :ref WHERE PAYMENT_ID = :pid`,
        { ref: txnRef, pid: paymentId }
      );
      await conn.commit();

      return {
        message: 'Payment completed successfully.',
        paymentId,
        checkoutUrl: null,
        amount: MEMBERSHIP_FEE,
        currency: 'BWP'
      };
    }

    // Real Stripe checkout
    const stripe = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: student.EMAIL,
      line_items: [{
        price_data: {
          currency: 'bwp',
          product_data: {
            name: `Club Membership Fee – ${paymentType === 'renewal' ? 'Renewal' : 'New Membership'}`,
            description: `Student: ${student.FIRST_NAME} ${student.LAST_NAME} (${studentId})`,
          },
          unit_amount: Math.round(MEMBERSHIP_FEE * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: { paymentId: String(paymentId), studentId, paymentType },
      success_url: `${process.env.PORTAL_URL || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.PORTAL_URL || 'http://localhost:3000'}/payment/cancel`,
    });

    await conn.execute(
      `UPDATE PAYMENT SET TRANSACTION_REFERENCE = :ref WHERE PAYMENT_ID = :pid`,
      { ref: session.id, pid: paymentId }
    );
    await conn.commit();

    return {
      message: 'Payment session created. Redirect the student to the checkout URL.',
      paymentId,
      checkoutUrl: session.url,
      amount: MEMBERSHIP_FEE,
      currency: 'BWP'
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Handle Stripe Webhook ─────────────────────────────────────────────
async function handleStripeWebhook(rawBody, signature) {
  // Check if Stripe is properly configured
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!stripeKey || stripeKey === 'sk_test_xxx' || !webhookSecret || webhookSecret === 'whsec_xxx') {
    // Development mode - no real Stripe, just acknowledge the webhook
    console.log('[DEV] Stripe webhook received in dev mode - acknowledged');
    return { received: true, simulated: true };
  }

  let event;
  try {
    const stripe = require('stripe')(stripeKey);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw appError('Webhook signature verification failed.', 400, 'INVALID_SIGNATURE');
  }

  let conn;
  try {
    conn = await getConnection();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { paymentId, studentId } = session.metadata;

      await conn.execute(
        `UPDATE PAYMENT SET PAYMENT_STATUS = 'success',
                            TRANSACTION_REFERENCE = :ref,
                            PAYMENT_DATE = SYSTIMESTAMP
         WHERE PAYMENT_ID = :pid`,
        { ref: session.payment_intent, pid: parseInt(paymentId) }
      );
      await conn.commit();

      return { received: true, paymentId, status: 'success' };
    }

    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      const session = event.data.object;
      const { paymentId } = session.metadata || {};
      if (paymentId) {
        await conn.execute(
          `UPDATE PAYMENT SET PAYMENT_STATUS = 'failed' WHERE PAYMENT_ID = :pid`,
          { pid: parseInt(paymentId) }
        );
        await conn.commit();
      }
    }

    return { received: true };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Payments by Member ID ───────────────────────────────────────────────
async function getPaymentsByMember(memberId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT p.PAYMENT_ID, p.STUDENT_ID, p.AMOUNT,
              TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS PAYMENT_DATE,
              p.PAYMENT_STATUS, p.TRANSACTION_REFERENCE
       FROM PAYMENT p
       WHERE p.STUDENT_ID = :id
       ORDER BY p.PAYMENT_DATE DESC`,
      { id: memberId }
    );
    return { memberId, payments: result.rows };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Payment (Admin) ───────────────────────────────────────────
async function deletePayment(paymentId) {
  let conn;
  try {
    conn = await getConnection();
    // First delete any associated memberships
    await conn.execute(`DELETE FROM MEMBERSHIP WHERE PAYMENT_ID = :id`, { id: paymentId });
    const result = await conn.execute(`DELETE FROM PAYMENT WHERE PAYMENT_ID = :id`, { id: paymentId });
    if (result.rowsAffected === 0) {
      throw appError('Payment not found.', 404, 'NOT_FOUND');
    }
    await conn.commit();
    return { message: 'Payment deleted successfully.', paymentId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = { getAllPayments, getPaymentById, getPaymentsByMember, initiatePayment, handleStripeWebhook, deletePayment };
