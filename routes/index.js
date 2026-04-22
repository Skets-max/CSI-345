// routes/index.js – All API route definitions
const express = require('express');
const { body, param, query } = require('express-validator');
const { validate, authenticate, requireAdmin, requireActiveMembership } = require('../middleware');

const authService         = require('../services/auth/authService');
const registrationService = require('../services/registration/registrationService');
const membershipService   = require('../services/membership/membershipService');
const bookingService      = require('../services/booking/bookingService');
const paymentService      = require('../services/payment/paymentService');
const notificationService = require('../services/notification/notificationService');
const cardService         = require('../services/card/cardService');
const reportsService      = require('../services/reports/reportsService');
const renewalService      = require('../services/renewal/renewalService');

const router = express.Router();

// ════════════════════════════════════════════════════════════════════════════
// 0. AUTHENTICATION
// ════════════════════════════════════════════════════════════════════════════

// POST /auth/login – Authenticate and receive JWT token
router.post(
  '/auth/login',
  [
    body('userId').notEmpty().withMessage('User ID is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body.userId, req.body.password);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /auth/dev-token – Generate a test JWT without DB (development only)
router.post(
  '/auth/dev-token',
  async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const jwt = require('jsonwebtoken');
    const { studentId = 'DEV001', role = 'student' } = req.body;
    const token = jwt.sign(
      { studentId, firstName: 'Dev', lastName: 'User', email: 'dev@test.ac.bw', role },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.json({ token, studentId, role, note: 'Development token only – not valid in production.' });
  }
);

// POST /auth/forgot-password – Request password reset
router.post(
  '/auth/forgot-password',
  [
    body('universityEmail').isEmail().withMessage('A valid university email is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const passwordResetService = require('../services/passwordReset/passwordResetService');
      const result = await passwordResetService.requestPasswordReset(req.body.universityEmail);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /auth/reset-password – Reset password with token
router.post(
  '/auth/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required.'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
      .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const passwordResetService = require('../services/passwordReset/passwordResetService');
      const result = await passwordResetService.resetPassword(req.body.token, req.body.newPassword);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// 1. STUDENT REGISTRATION SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /registrations/:registrationId – Get registration / student status
router.get(
  '/registrations/:registrationId',
  authenticate,
  [param('registrationId').notEmpty().withMessage('Registration ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      // Students may only view their own; admins may view any
      if (req.user.role !== 'admin' && req.user.studentId !== req.params.registrationId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      const result = await registrationService.getRegistrationStatus(req.params.registrationId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /registrations – Submit new student registration
router.post(
  '/registrations',
  [
    body('studentNumber').notEmpty().withMessage('Student number is required.'),
    body('firstName').notEmpty().withMessage('First name is required.'),
    body('lastName').notEmpty().withMessage('Last name is required.'),
    body('dateOfBirth').isDate().withMessage('Date of birth must be YYYY-MM-DD.'),
    body('universityEmail').isEmail().withMessage('A valid university email is required.'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
      .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await registrationService.createRegistration(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// NOTE: /registrations/resend-verification must be BEFORE /registrations/:registrationId/confirm-email
// POST /registrations/resend-verification – Resend verification email
router.post(
  '/registrations/resend-verification',
  [body('universityEmail').isEmail().withMessage('A valid university email is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await registrationService.resendVerification(req.body.universityEmail);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /registrations/:registrationId/confirm-email – Verify email with token
router.post(
  '/registrations/:registrationId/confirm-email',
  [
    param('registrationId').notEmpty(),
    body('token').notEmpty().withMessage('Verification token is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await registrationService.confirmEmail(
        req.params.registrationId,
        req.body.token
      );
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 2. MEMBERSHIP MANAGEMENT SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /members/by-email/:email – Find member by university email (admin)
router.get(
  '/members/by-email/:email',
  authenticate,
  requireAdmin,
  [param('email').isEmail().withMessage('A valid email is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.getMemberByEmail(req.params.email);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /members – List all members with pagination and optional status filter (admin)
router.get(
  '/members',
  authenticate,
  requireAdmin,
  [
    query('status').optional().isIn(['active','blocked','pending','verified']).withMessage('Invalid status filter.'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.getAllMembers({
        status: req.query.status,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /members/:memberId – Get member profile
router.get(
  '/members/:memberId',
  authenticate,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== 'admin' && req.user.studentId !== req.params.memberId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      const result = await membershipService.getMemberById(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /members/:memberId/membership – Get membership details for a student
router.get(
  '/members/:memberId/membership',
  authenticate,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== 'admin' && req.user.studentId !== req.params.memberId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      const result = await membershipService.getMembershipByStudentId(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /memberships – Create/activate a new membership after payment
router.post(
  '/memberships',
  authenticate,
  [
    body('studentId').notEmpty().withMessage('Student ID is required.'),
    body('paymentId').isInt({ min: 1 }).withMessage('A valid payment ID is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.createMembership(
        req.body.studentId,
        req.body.paymentId
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// POST /memberships/renew – Request membership renewal
router.post(
  '/memberships/renew',
  authenticate,
  async (req, res, next) => {
    try {
      const renewalService = require('../services/renewal/renewalService');
      const result = await renewalService.requestRenewal(req.user.studentId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /memberships/renew/:token – Get renewal details by token
router.get(
  '/memberships/renew/:token',
  async (req, res, next) => {
    try {
      const renewalService = require('../services/renewal/renewalService');
      const result = await renewalService.getRenewalByToken(req.params.token);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /memberships/renew/confirm – Confirm membership renewal
router.post(
  '/memberships/renew/confirm',
  [
    body('token').notEmpty().withMessage('Renewal token is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const renewalService = require('../services/renewal/renewalService');
      const result = await renewalService.processRenewal(req.body.token);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// PATCH /members/:memberId/block – Block a member account (admin only)
router.patch(
  '/members/:memberId/block',
  authenticate,
  requireAdmin,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.blockMember(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// PATCH /members/:memberId/unblock – Unblock a member account (admin only)
router.patch(
  '/members/:memberId/unblock',
  authenticate,
  requireAdmin,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.unblockMember(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /members/:memberId – Delete a member/membership (admin only)
router.delete(
  '/members/:memberId',
  authenticate,
  requireAdmin,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await membershipService.deleteMember(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 3. EQUIPMENT BOOKING SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /equipment – List all equipment (public)
router.get(
  '/equipment',
  [
    query('status').optional()
      .isIn(['available','unavailable','maintenance'])
      .withMessage('Invalid status filter.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.getAllEquipment({ status: req.query.status });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /equipment/:equipmentId/availability – Check equipment availability for a date
router.get(
  '/equipment/:equipmentId/availability',
  [
    param('equipmentId').isInt({ min: 1 }).withMessage('Invalid equipment ID.'),
    query('date').optional().isDate().withMessage('date must be YYYY-MM-DD.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { equipmentId } = req.params;
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const equipment = await bookingService.getEquipmentById(parseInt(equipmentId));
      const slots = await bookingService.getEquipmentAvailability(parseInt(equipmentId), date);
      res.status(200).json({
        equipmentId: parseInt(equipmentId),
        equipmentName: equipment.equipment.EQUIPMENT_NAME,
        date,
        availabilityStatus: equipment.equipment.AVAILABILITY_STATUS,
        bookedSlots: slots
      });
    } catch (err) { next(err); }
  }
);

// GET /equipment/:equipmentId – Get equipment details (public)
router.get(
  '/equipment/:equipmentId',
  [param('equipmentId').isInt({ min: 1 }).withMessage('Invalid equipment ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.getEquipmentById(parseInt(req.params.equipmentId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /equipment – Add new equipment (admin only)
router.post(
  '/equipment',
  authenticate,
  requireAdmin,
  [
    body('equipmentName').notEmpty().withMessage('Equipment name is required.'),
    body('description').optional(),
    body('availabilityStatus').optional().isIn(['available', 'maintenance', 'retired']).withMessage('Invalid status.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.createEquipment(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// PUT /equipment/:equipmentId – Update equipment (admin only)
router.put(
  '/equipment/:equipmentId',
  authenticate,
  requireAdmin,
  [param('equipmentId').isInt({ min: 1 }).withMessage('Invalid equipment ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.updateEquipment(
        parseInt(req.params.equipmentId),
        req.body
      );
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /equipment/:equipmentId – Delete equipment (admin only)
router.delete(
  '/equipment/:equipmentId',
  authenticate,
  requireAdmin,
  [param('equipmentId').isInt({ min: 1 }).withMessage('Invalid equipment ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.deleteEquipment(parseInt(req.params.equipmentId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /bookings – List bookings (students see their own; admins see all)
router.get(
  '/bookings',
  authenticate,
  [
    query('status').optional()
      .isIn(['confirmed','cancelled','completed'])
      .withMessage('Invalid status filter.'),
    query('date').optional().isDate().withMessage('Date must be YYYY-MM-DD.'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.getBookings({
        studentId: req.user.studentId,
        role: req.user.role,
        status: req.query.status,
        date: req.query.date,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /bookings/:bookingId – Get specific booking
router.get(
  '/bookings/:bookingId',
  authenticate,
  [param('bookingId').isInt({ min: 1 }).withMessage('Invalid booking ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.getBookingById(
        parseInt(req.params.bookingId),
        req.user.studentId,
        req.user.role
      );
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /bookings – Create a new equipment booking
router.post(
  '/bookings',
  authenticate,
  requireActiveMembership,
  [
    body('studentId').notEmpty().withMessage('Student ID is required.'),
    body('equipmentId').isInt({ min: 1 }).withMessage('A valid equipment ID is required.'),
    body('bookingDate').isDate().withMessage('Booking date must be YYYY-MM-DD.'),
    body('startTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Start time must be HH:MM.'),
    body('endTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('End time must be HH:MM.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.createBooking(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// PATCH /bookings/:bookingId/cancel – Cancel a booking
router.patch(
  '/bookings/:bookingId/cancel',
  authenticate,
  [param('bookingId').isInt({ min: 1 }).withMessage('Invalid booking ID.')],
  validate,
  async (req, res, next) => {
    try {
      const requestingStudentId = req.user.role === 'admin' ? null : req.user.studentId;
      const result = await bookingService.cancelBooking(
        parseInt(req.params.bookingId),
        requestingStudentId
      );
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /bookings/:bookingId – Delete a booking (admin only)
router.delete(
  '/bookings/:bookingId',
  authenticate,
  requireAdmin,
  [param('bookingId').isInt({ min: 1 }).withMessage('Invalid booking ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await bookingService.deleteBooking(parseInt(req.params.bookingId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 4. PAYMENT SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /payments – List payments (admin only)
router.get(
  '/payments',
  authenticate,
  requireAdmin,
  [
    query('status').optional()
      .isIn(['pending','success','failed','refunded'])
      .withMessage('Invalid payment status.'),
    query('studentId').optional().notEmpty(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await paymentService.getAllPayments({
        status: req.query.status,
        studentId: req.query.studentId,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /payments/member/:memberId – Get all payments for a member
router.get(
  '/payments/member/:memberId',
  authenticate,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== 'admin' && req.user.studentId !== req.params.memberId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      const result = await paymentService.getPaymentsByMember(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /payments/:paymentId – Get payment by ID
router.get(
  '/payments/:paymentId',
  authenticate,
  [param('paymentId').isInt({ min: 1 }).withMessage('Invalid payment ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await paymentService.getPaymentById(parseInt(req.params.paymentId));
      // Students may only view their own payments
      if (req.user.role !== 'admin' && result.payment.STUDENT_ID !== req.user.studentId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /payments – Initiate a membership fee payment
router.post(
  '/payments',
  authenticate,
  [
    body('studentId').notEmpty().withMessage('Student ID is required.'),
    body('paymentType')
      .isIn(['new_membership', 'renewal'])
      .withMessage('Payment type must be new_membership or renewal.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await paymentService.initiatePayment(
        req.body.studentId,
        req.body.paymentType
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// POST /payments/webhooks/gateway – Receive Stripe payment events (raw body required – see server.js)
router.post(
  '/payments/webhooks/gateway',
  async (req, res, next) => {
    try {
      const signature = req.headers['stripe-signature'];
      const result = await paymentService.handleStripeWebhook(req.body, signature);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /payments/:paymentId – Delete a payment (admin only)
router.delete(
  '/payments/:paymentId',
  authenticate,
  requireAdmin,
  [param('paymentId').isInt({ min: 1 }).withMessage('Invalid payment ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await paymentService.deletePayment(parseInt(req.params.paymentId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 5. NOTIFICATION SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /notifications – List notifications (admin)
router.get(
  '/notifications',
  authenticate,
  requireAdmin,
  [
    query('type').optional().notEmpty(),
    query('deliveryStatus').optional()
      .isIn(['pending','scheduled','sent','failed'])
      .withMessage('Invalid delivery status.'),
    query('studentId').optional().notEmpty(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await notificationService.getAllNotifications({
        type: req.query.type,
        deliveryStatus: req.query.deliveryStatus,
        studentId: req.query.studentId,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /notifications/:notificationId – Get notification details
router.get(
  '/notifications/:notificationId',
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      const notificationId = req.params.notificationId ? parseInt(req.params.notificationId) : null;
      const result = await notificationService.getNotificationById(notificationId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// POST /notifications/send – Queue a notification for delivery (admin)
router.post(
  '/notifications/send',
  authenticate,
  requireAdmin,
  [
    body('studentId').notEmpty().withMessage('Student ID is required.'),
    body('notificationType').notEmpty().withMessage('Notification type is required.'),
    body('recipientEmail').isEmail().withMessage('A valid recipient email is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await notificationService.sendNotification(req.body);
      res.status(202).json(result);
    } catch (err) { next(err); }
  }
);

// POST /notifications/:notificationId/retry – Retry a failed notification (admin)
router.post(
  '/notifications/:notificationId/retry',
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      const notificationId = req.params.notificationId ? parseInt(req.params.notificationId) : null;
      const result = await notificationService.retryNotification(notificationId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /notifications/:notificationId – Delete a notification (admin only)
router.delete(
  '/notifications/:notificationId',
  authenticate,
  requireAdmin,
  [param('notificationId').isInt({ min: 1 }).withMessage('Invalid notification ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await notificationService.deleteNotification(parseInt(req.params.notificationId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 6. MEMBERSHIP CARD SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /cards/verify/:qrPayload – Verify a membership card via QR code (public)
router.get(
  '/cards/verify/:qrPayload',
  [param('qrPayload').notEmpty().withMessage('QR payload is required.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await cardService.verifyCard(req.params.qrPayload);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /cards/member/:memberId – Get all cards for a member
router.get(
  '/cards/member/:memberId',
  authenticate,
  [param('memberId').notEmpty().withMessage('Member ID is required.')],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== 'admin' && req.user.studentId !== req.params.memberId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied.' });
      }
      const result = await cardService.getCardsByMember(req.params.memberId);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /cards/:cardId – Get membership card details
router.get(
  '/cards/:cardId',
  authenticate,
  [param('cardId').isInt({ min: 1 }).withMessage('Invalid card ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await cardService.getCard(parseInt(req.params.cardId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /cards/:cardId/download – Download card as PDF
router.get(
  '/cards/:cardId/download',
  authenticate,
  [param('cardId').isInt({ min: 1 }).withMessage('Invalid card ID.')],
  validate,
  async (req, res, next) => {
    try {
      await cardService.downloadCardAsPDF(parseInt(req.params.cardId), res);
    } catch (err) { next(err); }
  }
);

// POST /cards – Generate a membership card for an active membership
router.post(
  '/cards',
  authenticate,
  [
    body('memberId').notEmpty().withMessage('Member ID is required.'),
    body('firstName').notEmpty().withMessage('First name is required.'),
    body('lastName').notEmpty().withMessage('Last name is required.'),
    body('membershipId').isInt({ min: 1 }).withMessage('A valid membership ID is required.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await cardService.generateCard(req.body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /cards/:cardId – Delete a card (admin only)
router.delete(
  '/cards/:cardId',
  authenticate,
  requireAdmin,
  [param('cardId').isInt({ min: 1 }).withMessage('Invalid card ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await cardService.deleteCard(parseInt(req.params.cardId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 7. REPORTS SERVICE (admin only)
// ════════════════════════════════════════════════════════════════════════════

// GET /reports/memberships – Membership summary report
router.get(
  '/reports/memberships',
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      const result = await reportsService.getMembersReport();
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /reports/bookings – Booking statistics report
router.get(
  '/reports/bookings',
  authenticate,
  requireAdmin,
  [
    query('from').optional().isDate().withMessage('from must be YYYY-MM-DD.'),
    query('to').optional().isDate().withMessage('to must be YYYY-MM-DD.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await reportsService.getBookingsReport({
        from: req.query.from,
        to: req.query.to
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /reports/payments – Revenue report
router.get(
  '/reports/payments',
  authenticate,
  requireAdmin,
  [
    query('from').optional().isDate().withMessage('from must be YYYY-MM-DD.'),
    query('to').optional().isDate().withMessage('to must be YYYY-MM-DD.'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await reportsService.getPaymentsReport({
        from: req.query.from,
        to: req.query.to
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /reports/financial-summary – Financial summary report
router.get(
  '/reports/financial-summary',
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      const result = await reportsService.getFinancialSummary();
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /reports/audit – Audit log report
router.get(
  '/reports/audit',
  authenticate,
  requireAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await reportsService.getAuditReport({
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// GET /reports/expiring-memberships – Members expiring within N days
router.get(
  '/reports/expiring-memberships',
  authenticate,
  requireAdmin,
  [query('days').optional().isInt({ min: 1, max: 365 }).withMessage('days must be between 1 and 365.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await reportsService.getExpiringMembershipsReport({
        days: parseInt(req.query.days) || 60
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 8. RENEWAL MANAGEMENT SERVICE
// ════════════════════════════════════════════════════════════════════════════

// GET /renewals/:renewalId – Get renewal request details
router.get(
  '/renewals/:renewalId',
  authenticate,
  [param('renewalId').isInt({ min: 1 }).withMessage('Invalid renewal ID.')],
  validate,
  async (req, res, next) => {
    try {
      const result = await renewalService.getRenewalById(parseInt(req.params.renewalId));
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

module.exports = router;
