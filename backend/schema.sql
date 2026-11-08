-- Unified Accounts Platform — database schema
-- PostgreSQL 14+

CREATE TABLE IF NOT EXISTS businesses (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    currency      TEXT NOT NULL DEFAULT 'SAR',
    timezone      TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    email           TEXT,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    is_super_admin  BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Account security (two-factor authentication + recovery email)
    totp_enabled            BOOLEAN NOT NULL DEFAULT false,
    totp_secret             TEXT,  -- encrypted (AES-256-GCM), see src/security.js
    totp_pending_secret     TEXT,
    recovery_email          TEXT,
    recovery_email_verified BOOLEAN NOT NULL DEFAULT false,
    recovery_email_pending  TEXT,
    password_changed_at     TIMESTAMPTZ
);

-- One-time 2FA backup codes (only SHA-256 hashes are stored).
CREATE TABLE IF NOT EXISTS user_backup_codes (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes (user_id);

-- Password-reset links and recovery-email confirmation codes (only hashes are stored).
CREATE TABLE IF NOT EXISTS auth_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'verify_email')),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens (purpose, token_hash);

CREATE TABLE IF NOT EXISTS user_business_roles (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id   BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('business_admin', 'staff', 'viewer')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, business_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id                BIGSERIAL PRIMARY KEY,
    business_id       BIGINT NOT NULL REFERENCES businesses(id),
    user_id           BIGINT NOT NULL REFERENCES users(id),
    type              TEXT NOT NULL CHECK (type IN ('sales', 'expense', 'fixed_cost', 'salary')),
    occurred_on       DATE NOT NULL,
    amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    payment_method    TEXT CHECK (payment_method IN ('cash', 'card', 'bank') OR payment_method IS NULL), -- sales: cash/card; expenses & fixed costs: cash/card/bank
    fixed_cost_type   TEXT CHECK (fixed_cost_type IN ('rent', 'maintenance', 'utilities', 'other') OR fixed_cost_type IS NULL),
    expense_category  TEXT CHECK (expense_category IN ('supplies', 'utilities', 'maintenance', 'transport', 'marketing', 'other') OR expense_category IS NULL),
    description       TEXT,
    supplier_name     TEXT,   -- expenses and fixed costs: who it was bought from
    invoice_number    TEXT,   -- expenses and fixed costs: the supplier's invoice number
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_business_date ON transactions (business_id, occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_business_type_date ON transactions (business_id, type, occurred_on) WHERE deleted_at IS NULL;

-- Purchase invoices (photos/PDFs) attached to expense and fixed-cost entries. The files live in
-- Oracle Object Storage (see OCI_INVOICE_PAR_URL); this table keeps the record of each one.
CREATE TABLE IF NOT EXISTS transaction_attachments (
    id             BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT NOT NULL REFERENCES transactions(id),
    business_id    BIGINT NOT NULL REFERENCES businesses(id),
    object_key     TEXT NOT NULL,
    file_name      TEXT NOT NULL,
    content_type   TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    uploaded_by    BIGINT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON transaction_attachments (transaction_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    business_id   BIGINT REFERENCES businesses(id),
    user_id       BIGINT REFERENCES users(id),
    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     BIGINT,
    changes       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_business ON audit_log (business_id, created_at DESC);
