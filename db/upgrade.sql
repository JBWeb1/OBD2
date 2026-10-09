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
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS monitor_tests JSONB;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE scan_sessions ADD COLUMN IF NOT EXISTS ecu_info JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS share_engine_data BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE remaps ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS ecu_profiles (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ecu_name TEXT NOT NULL, ecu_key TEXT NOT NULL, make TEXT,
  access_method TEXT NOT NULL DEFAULT 'unknown', tool TEXT, security_note TEXT,
  road_legal TEXT NOT NULL DEFAULT 'check', notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ecu_key)
);
CREATE INDEX IF NOT EXISTS ecu_profiles_tenant_idx ON ecu_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS ecu_profiles_key_idx ON ecu_profiles(ecu_key);
CREATE TABLE IF NOT EXISTS vehicle_mods (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other', title TEXT NOT NULL, road_legal TEXT NOT NULL DEFAULT 'check',
  done_on DATE NOT NULL DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_mods_tenant_idx ON vehicle_mods(tenant_id, vehicle_id);
