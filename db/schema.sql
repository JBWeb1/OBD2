-- DiagnosticOS schema. Every business table carries tenant_id; the API scopes every query by it.
-- Money is stored as integer cents.

CREATE TABLE IF NOT EXISTS tenants (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  plan             TEXT NOT NULL DEFAULT 'starter',
  plan_status      TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at    TIMESTAMP,
  email            TEXT,
  phone            TEXT,
  address          TEXT,
  vat_number       TEXT,
  next_invoice_no  INTEGER NOT NULL DEFAULT 1,
  payfast_token    TEXT,
  bank_details     TEXT,
  logo             TEXT,             -- small data: URL (png/jpeg), shown on PDFs
  reminders_enabled BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMP,
  pf_merchant_id   TEXT,              -- the workshop's OWN PayFast account, used for customer invoice payment links
  pf_merchant_key  TEXT,
  pf_passphrase_enc TEXT,            -- AES-GCM encrypted
  share_engine_data BOOLEAN NOT NULL DEFAULT false, -- opt-in: pool anonymous engine data with other shops so learning is faster
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'technician',
  email_verified BOOLEAN NOT NULL DEFAULT false,
  token_version  INTEGER NOT NULL DEFAULT 0,     -- bumped on password change/reset: older sessions stop working
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);

CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL DEFAULT '',
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers(tenant_id);

CREATE TABLE IF NOT EXISTS vehicles (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  plate        TEXT,
  vin          TEXT,
  make         TEXT NOT NULL,
  model        TEXT NOT NULL,
  year         INTEGER,
  engine       TEXT,
  colour       TEXT,
  mileage_km   INTEGER,
  next_service_on DATE,
  next_service_km INTEGER,
  reminder_sent_on DATE,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_tenant_idx ON vehicles(tenant_id);

CREATE TABLE IF NOT EXISTS scan_sessions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  protocol    TEXT,
  source      TEXT NOT NULL DEFAULT 'adapter',   -- 'adapter' (real ELM327) or 'demo'
  started_at  TIMESTAMP NOT NULL DEFAULT now(),
  ended_at    TIMESTAMP,
  summary     JSONB,                             -- { "010C": {min,max,avg,unit}, ... }
  samples     JSONB,                             -- capped time series for charts
  readiness   JSONB,                             -- MIL + monitor status (Mode 01 PID 01)
  freeze_frame JSONB,                            -- freeze-frame data (Mode 02)
  monitor_tests JSONB,                           -- on-board monitor test results (Mode 06)
  kind        TEXT,                              -- 'live' scan, 'pull' (full-throttle run), or NULL (codes/tests only)
  ecu_info    JSONB                              -- ECU software identity (Mode 09): calibration IDs, CVNs, ECU names
);
CREATE INDEX IF NOT EXISTS scans_tenant_idx ON scan_sessions(tenant_id, started_at);

CREATE TABLE IF NOT EXISTS dtc_events (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  scan_id     INTEGER REFERENCES scan_sessions(id) ON DELETE SET NULL,
  code        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',    -- active | pending | cleared
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  cleared_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS dtc_tenant_idx ON dtc_events(tenant_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'invoice',  -- invoice | quote
  customer_id  INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id   INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'outstanding', -- outstanding | paid | overdue | draft | accepted
  items        JSONB NOT NULL DEFAULT '[]',
  total_cents  INTEGER NOT NULL DEFAULT 0,
  issued_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on       DATE,
  paid_at      TIMESTAMP,
  pay_token    TEXT UNIQUE,
  UNIQUE (tenant_id, kind, number)
);

CREATE TABLE IF NOT EXISTS inspections (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id     INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  type           TEXT NOT NULL DEFAULT 'service',
  items          JSONB NOT NULL DEFAULT '{}',    -- { "Engine oil level & condition": true, ... }
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  signed_off_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  signed_off_at  TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remaps (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id   INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  ecu          TEXT,
  stage        TEXT,
  power_before_kw  INTEGER,
  power_after_kw   INTEGER,
  tuner        TEXT,
  notes        TEXT,
  done_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- reset | verify
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    INTEGER,
  user_name  TEXT,
  action     TEXT NOT NULL,                   -- e.g. "DELETE /customers/4"
  entity     TEXT,
  entity_id  INTEGER,
  status     INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'booked',   -- booked | in_progress | ready | done
  scheduled_for TIMESTAMP,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_tenant_idx ON jobs(tenant_id, status);

CREATE TABLE IF NOT EXISTS inspection_photos (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item          TEXT,
  mime          TEXT NOT NULL,
  data          TEXT NOT NULL,                    -- base64
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_insp_idx ON inspection_photos(inspection_id);

CREATE TABLE IF NOT EXISTS parts (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku         TEXT,
  name        TEXT NOT NULL,
  supplier    TEXT,
  cost_cents  INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  qty         INTEGER NOT NULL DEFAULT 0,
  min_qty     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_tenant_idx ON parts(tenant_id);
