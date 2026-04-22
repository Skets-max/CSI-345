// services/notification/emailService.js
const nodemailer = require('nodemailer');

// Check if SMTP is properly configured
const isEmailConfigured = process.env.SMTP_USER && 
  process.env.SMTP_USER !== 'your_email@gmail.com' &&
  process.env.SMTP_PASS && 
  process.env.SMTP_PASS !== 'your_app_password';

let transporter = null;

if (isEmailConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendEmail({ to, subject, html }) {
  // Skip email in development if not configured
  if (!transporter) {
    console.log(`[DEV] Email would be sent to ${to}`);
    console.log(`[DEV] Subject: ${subject}`);
    console.log(`[DEV] Link in email: ${html.substring(html.indexOf('href='), html.indexOf('>', html.indexOf('href=')))}`);
    return { simulated: true, message: 'Email simulated in dev mode' };
  }
  
  await transporter.sendMail({
    from: `"Student Club Portal" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function verificationEmail(firstName, verificationLink) {
  return {
    subject: 'Verify Your Student Club Account',
    html: `
      <h2>Welcome, ${firstName}!</h2>
      <p>Please verify your email address to activate your account.</p>
      <p><a href="${verificationLink}" style="background:#007bff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Verify Email</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not register, please ignore this email.</p>
    `,
  };
}

function passwordResetEmail(firstName, resetLink) {
  return {
    subject: 'Reset Your Password – Student Club Portal',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hi ${firstName}, we received a request to reset your password.</p>
      <p><a href="${resetLink}" style="background:#dc3545;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Reset Password</a></p>
      <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
    `,
  };
}

function otpEmail(firstName, otp) {
  return {
    subject: 'Your 2FA Verification Code – Student Club Portal',
    html: `
      <h2>Two-Factor Authentication</h2>
      <p>Hi ${firstName}, your one-time verification code is:</p>
      <h1 style="letter-spacing:8px;color:#007bff;">${otp}</h1>
      <p>This code expires in 10 minutes. Do not share it with anyone.</p>
    `,
  };
}

function bookingReminderEmail(firstName, equipmentName, bookingDate, startTime) {
  return {
    subject: `Booking Reminder: ${equipmentName} in 2 Hours`,
    html: `
      <h2>Booking Reminder</h2>
      <p>Hi ${firstName}, this is a reminder that your booking starts in 2 hours.</p>
      <ul>
        <li><strong>Equipment:</strong> ${equipmentName}</li>
        <li><strong>Date:</strong> ${bookingDate}</li>
        <li><strong>Start Time:</strong> ${startTime}</li>
      </ul>
      <p>Please arrive on time. Contact us if you need to cancel.</p>
    `,
  };
}

function membershipRenewalReminderEmail(firstName, expiryDate) {
  return {
    subject: 'Your Club Membership Expires Soon – Renew Now',
    html: `
      <h2>Membership Renewal Reminder</h2>
      <p>Hi ${firstName}, your club membership expires on <strong>${expiryDate}</strong>.</p>
      <p>Renew now to continue enjoying club benefits without interruption.</p>
      <p><a href="${process.env.PORTAL_URL || '#'}/renew" style="background:#28a745;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Renew Membership</a></p>
    `,
  };
}

function renewalLinkEmail(firstName, renewalLink) {
  return {
    subject: 'Your Membership Renewal Link – Student Club Portal',
    html: `
      <h2>Membership Renewal</h2>
      <p>Hi ${firstName}, click the link below to renew your membership.</p>
      <p><a href="${renewalLink}" style="background:#28a745;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Renew Membership</a></p>
      <p>This link expires in 48 hours.</p>
    `,
  };
}

module.exports = {
  sendEmail,
  verificationEmail,
  passwordResetEmail,
  otpEmail,
  bookingReminderEmail,
  membershipRenewalReminderEmail,
  renewalLinkEmail,
};
