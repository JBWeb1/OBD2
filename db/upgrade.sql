-- Run automatically by `npm run migrate` after schema.sql. Brings databases created by an earlier version up to date.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_details TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_service_on DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_service_km INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS reminder_sent_on DATE;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS readiness JSONB;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS freeze_frame JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pay_token TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pf_merchant_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pf_merchant_key TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pf_passphrase_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
