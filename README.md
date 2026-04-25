# Student Club Portal API
### CSI345 – Task 6: POST, PATCH & DELETE Endpoints

---

## Project Structure

```
student-club-portal/
├── server.js                          # Entry point
├── .env.example                       # Environment variable template
├── keycloak.json                      # Keycloak client config
├── package.json
├── db/
│   ├── oracle.js                      # Oracle connection pool
│   └── schema.sql                     # Run this in Oracle first
├── middleware/
│   ├── index.js                       # Auth, validation, error handling
│   └── keycloak.js                    # Keycloak session and adapter setup
├── routes/
│   └── index.js                       # All API routes
├── services/
│   ├── registration/
│   │   └── registrationService.js     # POST /registrations
│   ├── membership/
│   │   └── membershipService.js       # POST /memberships, PATCH block/unblock
│   ├── booking/
│   │   └── bookingService.js          # POST /bookings, PATCH /cancel
│   ├── payment/
│   │   └── paymentService.js          # POST /payments + Stripe webhook
│   ├── notification/
│   │   ├── notificationService.js     # POST /notifications/send + retry
│   │   └── emailService.js            # Nodemailer + all email templates
│   └── card/
│       └── cardService.js             # POST /cards + PDF download
└── StudentClubPortal.postman_collection.json
```

---

## Setup Instructions

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
```bash
cp .env.example .env
# Edit .env with your Oracle, Stripe, SMTP credentials
```

### 2.1 Configure Keycloak
- Confirm `keycloak.json` exists in the project root.
- Update `auth-server-url`, `realm`, and client settings if your Keycloak instance differs.
- Set `SESSION_SECRET` in `.env` for secure session handling.

### 3. Set up the Oracle database
```sql
-- Connect to Oracle as your user and run:
@db/schema.sql
```

### 4. Start the server
```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

### 5. Import the Postman collection
Import `StudentClubPortal.postman_collection.json` into Postman and set the `baseUrl` and `token` variables.

---

## Implemented Endpoints (Task 6)

### 1. Student Registration Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/registrations` | Register a new student (validates with SARMS, hashes password, sends verification email) |
| `POST` | `/registrations/:id/confirm-email` | Confirm email using token from verification link |
| `POST` | `/registrations/resend-verification` | Resend the verification email (rate-limited to 3/hour) |

### 2. Membership Management Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/memberships` | Activate membership after confirmed payment |
| `PATCH` | `/members/:id/block` | Block a member account *(admin only)* |
| `PATCH` | `/members/:id/unblock` | Unblock a member account *(admin only)* |

### 3. Equipment Booking Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/bookings` | Create a booking (checks membership, availability, prevents overlaps) |
| `PATCH` | `/bookings/:id/cancel` | Cancel a booking (30-min window enforced) |

### 4. Payment Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/payments` | Initiate a Stripe payment session for membership fee |
| `POST` | `/payments/webhooks/gateway` | Receive Stripe webhook events to confirm/fail payments |

### 5. Notification Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/notifications/send` | Queue and send a notification email *(admin only)* |
| `POST` | `/notifications/:id/retry` | Retry a previously failed notification *(admin only)* |

### 6. Membership Card Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cards` | Generate a digital membership card with QR code |
| `GET` | `/cards/:id/download` | Download the card as a PDF |

---

## Key Integration Points

| External Service | Used For |
|-----------------|----------|
| **Keycloak** | Protecting API routes with access tokens, role-based access control, and session handling |
| **SARMS API** | Student validation during registration |
| **Stripe** | Payment processing + webhook confirmation |
| **Nodemailer (SMTP)** | All email notifications (verification, OTP, booking reminders, etc.) |
| **QRCode + PDFKit** | Membership card generation and PDF download |

---

## Security Features
- Keycloak access token validation on protected routes
- Role-based access control (student vs admin) using Keycloak role mappings
- `express-session` + Keycloak middleware for authentication context
- JWT authentication fallback on legacy tokens where supported
- Bcrypt password hashing (12 salt rounds)
- Input validation on all POST endpoints via `express-validator`
- Stripe webhook signature verification
- Rate limiting on auth and registration endpoints
- Oracle transactions for data integrity

---

## Notes for Postman Testing
1. Call `POST /registrations` first, check your email for the verification link.
2. Confirm email via `POST /registrations/:id/confirm-email`.
3. Initiate payment via `POST /payments` – use Stripe's test card `4242 4242 4242 4242`.
4. The Stripe webhook fires automatically (use [Stripe CLI](https://stripe.com/docs/stripe-cli) for local testing: `stripe listen --forward-to localhost:3000/payments/webhooks/gateway`).
5. Once membership is active, test `POST /bookings` and `POST /cards`.
