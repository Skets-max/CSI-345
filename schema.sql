-- ============================================================
-- Student Club Portal - Oracle DDL Script
-- Run this in your Oracle schema before starting the server
-- ============================================================

-- ─── Sequences ───────────────────────────────────────────────
CREATE SEQUENCE TOKEN_SEQ         START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE PAYMENT_SEQ       START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE MEMBERSHIP_SEQ    START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE BOOKING_SEQ       START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE NOTIFICATION_SEQ  START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE CARD_SEQ          START WITH 1 INCREMENT BY 1 NOCACHE;

-- ─── Student ─────────────────────────────────────────────────
CREATE TABLE STUDENT (
    STUDENT_ID      VARCHAR2(20)    PRIMARY KEY,
    FIRST_NAME      VARCHAR2(100)   NOT NULL,
    LAST_NAME       VARCHAR2(100)   NOT NULL,
    DATE_OF_BIRTH   DATE            NOT NULL,
    EMAIL           VARCHAR2(255)   NOT NULL UNIQUE,
    PASSWORD_HASH   VARCHAR2(255)   NOT NULL,
    PHONE_NUMBER    VARCHAR2(20),
    ACCOUNT_STATUS  VARCHAR2(20)    DEFAULT 'pending'
                    CHECK (ACCOUNT_STATUS IN ('pending','verified','active','blocked')),
    CREATED_AT      TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- ─── Verification Token ──────────────────────────────────────
CREATE TABLE VERIFICATION_TOKEN (
    TOKEN_ID    NUMBER          PRIMARY KEY,
    STUDENT_ID  VARCHAR2(20)    NOT NULL REFERENCES STUDENT(STUDENT_ID) ON DELETE CASCADE,
    TOKEN_VALUE VARCHAR2(100)   NOT NULL UNIQUE,
    TOKEN_TYPE  VARCHAR2(30)    NOT NULL
                CHECK (TOKEN_TYPE IN ('email_verification','password_reset','2fa_otp')),
    EXPIRES_AT  TIMESTAMP       NOT NULL,
    IS_USED     NUMBER(1)       DEFAULT 0 CHECK (IS_USED IN (0,1)),
    CREATED_AT  TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- ─── Payment ─────────────────────────────────────────────────
CREATE TABLE PAYMENT (
    PAYMENT_ID              NUMBER          PRIMARY KEY,
    STUDENT_ID              VARCHAR2(20)    NOT NULL REFERENCES STUDENT(STUDENT_ID),
    AMOUNT                  NUMBER(10,2)    NOT NULL,
    PAYMENT_DATE            TIMESTAMP       DEFAULT SYSTIMESTAMP,
    PAYMENT_STATUS          VARCHAR2(20)    DEFAULT 'pending'
                            CHECK (PAYMENT_STATUS IN ('pending','success','failed','refunded')),
    TRANSACTION_REFERENCE   VARCHAR2(255)   UNIQUE
);

-- ─── Membership ──────────────────────────────────────────────
CREATE TABLE MEMBERSHIP (
    MEMBERSHIP_ID       NUMBER          PRIMARY KEY,
    STUDENT_ID          VARCHAR2(20)    NOT NULL REFERENCES STUDENT(STUDENT_ID),
    PAYMENT_ID          NUMBER          REFERENCES PAYMENT(PAYMENT_ID),
    MEMBERSHIP_NUMBER   VARCHAR2(50)    NOT NULL UNIQUE,
    START_DATE          DATE            NOT NULL,
    END_DATE            DATE            NOT NULL,
    RENEWAL_DATE        DATE,
    STATUS              VARCHAR2(20)    DEFAULT 'active'
                        CHECK (STATUS IN ('active','expired','blocked','pending'))
);

-- ─── Membership Card ─────────────────────────────────────────
CREATE TABLE MEMBERSHIP_CARD (
    CARD_ID         NUMBER          PRIMARY KEY,
    MEMBERSHIP_ID   NUMBER          NOT NULL REFERENCES MEMBERSHIP(MEMBERSHIP_ID),
    CARD_NUMBER     VARCHAR2(100)   NOT NULL UNIQUE,
    QR_CODE_DATA    VARCHAR2(2000),
    GENERATED_AT    TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- ─── Equipment ───────────────────────────────────────────────
CREATE TABLE EQUIPMENT (
    EQUIPMENT_ID        NUMBER          PRIMARY KEY,
    EQUIPMENT_NAME      VARCHAR2(200)   NOT NULL,
    DESCRIPTION         VARCHAR2(1000),
    AVAILABILITY_STATUS VARCHAR2(20)    DEFAULT 'available'
                        CHECK (AVAILABILITY_STATUS IN ('available','unavailable','maintenance')),
    CREATED_AT          TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- Auto-increment for Equipment via trigger
CREATE SEQUENCE EQUIPMENT_SEQ START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE OR REPLACE TRIGGER EQUIPMENT_BI
  BEFORE INSERT ON EQUIPMENT
  FOR EACH ROW
  WHEN (NEW.EQUIPMENT_ID IS NULL)
BEGIN
  :NEW.EQUIPMENT_ID := EQUIPMENT_SEQ.NEXTVAL;
END;
/

-- ─── Booking ─────────────────────────────────────────────────
CREATE TABLE BOOKING (
    BOOKING_ID      NUMBER          PRIMARY KEY,
    STUDENT_ID      VARCHAR2(20)    NOT NULL REFERENCES STUDENT(STUDENT_ID),
    EQUIPMENT_ID    NUMBER          NOT NULL REFERENCES EQUIPMENT(EQUIPMENT_ID),
    BOOKING_DATE    DATE            NOT NULL,
    START_TIME      VARCHAR2(5)     NOT NULL,   -- HH:MM
    END_TIME        VARCHAR2(5)     NOT NULL,   -- HH:MM
    BOOKING_STATUS  VARCHAR2(20)    DEFAULT 'confirmed'
                    CHECK (BOOKING_STATUS IN ('confirmed','cancelled','completed')),
    CREATED_AT      TIMESTAMP       DEFAULT SYSTIMESTAMP,
    CONSTRAINT CHK_BOOKING_TIME CHECK (START_TIME < END_TIME)
);

-- Prevent overlapping bookings at DB level
CREATE UNIQUE INDEX IDX_NO_OVERLAP ON BOOKING (
    EQUIPMENT_ID, BOOKING_DATE, START_TIME, END_TIME
) WHERE BOOKING_STATUS != 'cancelled';

-- ─── Notification ────────────────────────────────────────────
CREATE TABLE NOTIFICATION (
    NOTIFICATION_ID     NUMBER          PRIMARY KEY,
    STUDENT_ID          VARCHAR2(20)    REFERENCES STUDENT(STUDENT_ID),
    NOTIFICATION_TYPE   VARCHAR2(50)    NOT NULL,
    MESSAGE             CLOB,
    RECIPIENT_EMAIL     VARCHAR2(255),
    SEND_DATE           TIMESTAMP,
    DELIVERY_STATUS     VARCHAR2(20)    DEFAULT 'pending'
                        CHECK (DELIVERY_STATUS IN ('pending','scheduled','sent','failed'))
);

-- ─── Sample Equipment Data ────────────────────────────────────
INSERT INTO EQUIPMENT (EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS) VALUES
  ('Tennis Racket', '4 x Wilson Pro Staff rackets available', 'available');
INSERT INTO EQUIPMENT (EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS) VALUES
  ('Football', 'Size 5 match footballs', 'available');
INSERT INTO EQUIPMENT (EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS) VALUES
  ('Badminton Set', 'Full badminton set including net and rackets', 'available');
INSERT INTO EQUIPMENT (EQUIPMENT_NAME, DESCRIPTION, AVAILABILITY_STATUS) VALUES
  ('Basketball', 'Spalding NBA official ball', 'available');
COMMIT;
