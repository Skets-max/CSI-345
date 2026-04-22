// services/card/cardService.js
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const { getConnection } = require('../../db/oracle');

function appError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ─── GET: Card Details ────────────────────────────────────────────────────────
async function getCard(cardId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT mc.CARD_ID, mc.CARD_NUMBER,
              TO_CHAR(mc.GENERATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS GENERATED_AT,
              m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.START_DATE, 'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS END_DATE,
              s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME, s.EMAIL
       FROM MEMBERSHIP_CARD mc
       JOIN MEMBERSHIP m ON mc.MEMBERSHIP_ID = m.MEMBERSHIP_ID
       JOIN STUDENT s ON m.STUDENT_ID = s.STUDENT_ID
       WHERE mc.CARD_ID = :id`,
      { id: cardId }
    );
    if (result.rows.length === 0) {
      throw appError('Membership card not found.', 404, 'NOT_FOUND');
    }
    return { card: result.rows[0] };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── POST: Generate Membership Card ──────────────────────────────────────────
async function generateCard(data) {
  const { memberId, firstName, lastName, membershipId } = data;
  let conn;
  try {
    conn = await getConnection();

    // Verify membership exists and is active
    const membershipResult = await conn.execute(
      `SELECT MEMBERSHIP_ID, MEMBERSHIP_NUMBER, STATUS,
              TO_CHAR(START_DATE, 'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(END_DATE, 'YYYY-MM-DD') AS END_DATE
       FROM MEMBERSHIP
       WHERE MEMBERSHIP_ID = :mid AND STUDENT_ID = :sid AND STATUS = 'active'`,
      { mid: membershipId, sid: memberId }
    );
    if (membershipResult.rows.length === 0) {
      throw appError('Active membership not found for this member.', 404, 'NOT_FOUND');
    }

    const membership = membershipResult.rows[0];

    // Check if card already exists
    const existingCard = await conn.execute(
      `SELECT CARD_ID FROM MEMBERSHIP_CARD WHERE MEMBERSHIP_ID = :mid`,
      { mid: membershipId }
    );
    if (existingCard.rows.length > 0) {
      throw appError('A membership card already exists for this membership.', 409, 'CARD_EXISTS');
    }

    const cardNumber = `CARD-${memberId}-${uuidv4().substring(0, 8).toUpperCase()}`;
    const qrData = JSON.stringify({
      cardNumber,
      studentId: memberId,
      membershipNumber: membership.MEMBERSHIP_NUMBER,
      validUntil: membership.END_DATE,
    });

    await conn.execute(
      `INSERT INTO MEMBERSHIP_CARD (CARD_ID, MEMBERSHIP_ID, CARD_NUMBER, QR_CODE_DATA)
       VALUES ((SELECT NVL(MAX(CARD_ID),0)+1 FROM MEMBERSHIP_CARD), :mid, :cn, :qr)`,
      { mid: membershipId, cn: cardNumber, qr: qrData }
    );

    const cardIdResult = await conn.execute(`SELECT MAX(CARD_ID) AS CID FROM MEMBERSHIP_CARD`);
    const cardId = cardIdResult.rows[0].CID;
    await conn.commit();

    return {
      message: 'Membership card generated successfully.',
      cardId,
      cardNumber,
      memberName: `${firstName} ${lastName}`,
      membershipNumber: membership.MEMBERSHIP_NUMBER,
      validFrom: membership.START_DATE,
      validUntil: membership.END_DATE,
      downloadUrl: `/cards/${cardId}/download`
    };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Download Card as PDF ────────────────────────────────────────────────
async function downloadCardAsPDF(cardId, res) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT mc.CARD_NUMBER, mc.QR_CODE_DATA,
              m.MEMBERSHIP_NUMBER,
              TO_CHAR(m.START_DATE, 'DD Mon YYYY') AS START_DATE,
              TO_CHAR(m.END_DATE, 'DD Mon YYYY') AS END_DATE,
              s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME
       FROM MEMBERSHIP_CARD mc
       JOIN MEMBERSHIP m ON mc.MEMBERSHIP_ID = m.MEMBERSHIP_ID
       JOIN STUDENT s ON m.STUDENT_ID = s.STUDENT_ID
       WHERE mc.CARD_ID = :id`,
      { id: cardId }
    );
    if (result.rows.length === 0) {
      throw appError('Membership card not found.', 404, 'NOT_FOUND');
    }

    const card = result.rows[0];

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(card.QR_CODE_DATA || card.CARD_NUMBER, { width: 120 });
    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

    // Build PDF
    const doc = new PDFDocument({ size: [340, 200], margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="membership-card-${card.CARD_NUMBER}.pdf"`);
    doc.pipe(res);

    // Card background
    doc.rect(0, 0, 340, 200).fill('#003087');

    // Header bar
    doc.rect(0, 0, 340, 40).fill('#0056b3');
    doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold')
      .text('STUDENT CLUB PORTAL', 10, 12, { align: 'center', width: 320 });

    // Member name
    doc.fontSize(18).fillColor('#ffffff').font('Helvetica-Bold')
      .text(`${card.FIRST_NAME} ${card.LAST_NAME}`, 20, 55);

    // Student ID
    doc.fontSize(10).fillColor('#aad4f5').font('Helvetica')
      .text(`Student ID: ${card.STUDENT_ID}`, 20, 80)
      .text(`Membership #: ${card.MEMBERSHIP_NUMBER}`, 20, 95)
      .text(`Valid: ${card.START_DATE} – ${card.END_DATE}`, 20, 110);

    // Card number
    doc.fontSize(9).fillColor('#cccccc')
      .text(card.CARD_NUMBER, 20, 165);

    // QR code
    doc.image(qrBuffer, 240, 50, { width: 90, height: 90 });
    doc.fontSize(7).fillColor('#aad4f5').text('Scan to verify', 253, 145);

    doc.end();
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Cards by Member ID ──────────────────────────────────────────────────
async function getCardsByMember(memberId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT mc.CARD_ID, mc.CARD_NUMBER,
              TO_CHAR(mc.GENERATED_AT, 'YYYY-MM-DD"T"HH24:MI:SS') AS GENERATED_AT,
              m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.START_DATE, 'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS END_DATE
       FROM MEMBERSHIP_CARD mc
       JOIN MEMBERSHIP m ON mc.MEMBERSHIP_ID = m.MEMBERSHIP_ID
       WHERE m.STUDENT_ID = :id
       ORDER BY mc.GENERATED_AT DESC`,
      { id: memberId }
    );
    return { memberId, cards: result.rows };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── GET: Verify Card by QR Payload ──────────────────────────────────────────
async function verifyCard(qrPayload) {
  let conn;
  try {
    conn = await getConnection();
    // qrPayload is the CARD_NUMBER encoded in the QR
    const result = await conn.execute(
      `SELECT mc.CARD_ID, mc.CARD_NUMBER,
              TO_CHAR(mc.GENERATED_AT, 'YYYY-MM-DD') AS GENERATED_AT,
              m.MEMBERSHIP_NUMBER, m.STATUS AS MEMBERSHIP_STATUS,
              TO_CHAR(m.START_DATE, 'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(m.END_DATE, 'YYYY-MM-DD') AS END_DATE,
              s.STUDENT_ID, s.FIRST_NAME, s.LAST_NAME
       FROM MEMBERSHIP_CARD mc
       JOIN MEMBERSHIP m ON mc.MEMBERSHIP_ID = m.MEMBERSHIP_ID
       JOIN STUDENT s ON m.STUDENT_ID = s.STUDENT_ID
       WHERE mc.CARD_NUMBER = :qr OR mc.QR_CODE_DATA LIKE '%' || :qr2 || '%'`,
      { qr: qrPayload, qr2: qrPayload }
    );
    if (result.rows.length === 0) {
      return { valid: false, message: 'Card not found or QR code is invalid.' };
    }
    const card = result.rows[0];
    const isActive = card.MEMBERSHIP_STATUS === 'active';
    const isExpired = new Date(card.END_DATE) < new Date();
    return {
      valid: isActive && !isExpired,
      cardNumber: card.CARD_NUMBER,
      memberName: `${card.FIRST_NAME} ${card.LAST_NAME}`,
      studentId: card.STUDENT_ID,
      membershipNumber: card.MEMBERSHIP_NUMBER,
      membershipStatus: card.MEMBERSHIP_STATUS,
      validFrom: card.START_DATE,
      validUntil: card.END_DATE,
      message: isActive && !isExpired ? 'Valid membership card.' : 'Membership is not active or has expired.'
    };
  } finally {
    if (conn) await conn.close();
  }
}

// ─── DELETE: Delete Card (Admin) ───────────────────────────────────────────────
async function deleteCard(cardId) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`DELETE FROM MEMBERSHIP_CARD WHERE CARD_ID = :id`, { id: cardId });
    if (result.rowsAffected === 0) {
      throw appError('Card not found.', 404, 'NOT_FOUND');
    }
    await conn.commit();
    return { message: 'Card deleted successfully.', cardId };
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = { getCard, getCardsByMember, verifyCard, generateCard, downloadCardAsPDF, deleteCard };
