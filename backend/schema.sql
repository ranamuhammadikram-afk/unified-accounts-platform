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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
    payment_method    TEXT CHECK (payment_method IN ('cash', 'card') OR payment_method IS NULL),
    fixed_cost_type   TEXT CHECK (fixed_cost_type IN ('rent', 'maintenance', 'utilities', 'other') OR fixed_cost_type IS NULL),
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_business_date ON transactions (business_id, occurred_on) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_business_type_date ON transactions (business_id, type, occurred_on) WHERE deleted_at IS NULL;

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
