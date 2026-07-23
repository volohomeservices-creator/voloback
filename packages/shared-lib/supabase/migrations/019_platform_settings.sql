CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default values
INSERT INTO platform_settings (key, value, description) VALUES
  ('commission_rate',       '15',     'Admin commission percentage (%)'),
  ('worker_share_rate',     '85',     'Worker share percentage (%)'),
  ('search_radius_km',      '10',     'Default worker search radius in km'),
  ('assignment_timeout_sec','120',    'Seconds before job auto-reassigns'),
  ('settlement_day',        '0',      'Day of week for payouts (0=Sunday)'),
  ('settlement_time_utc',   '16:30',  'UTC time for weekly settlement'),
  ('min_cod_wallet_balance','500',    'Minimum worker wallet balance for COD jobs'),
  ('max_otp_attempts',      '5',      'Max OTP verification attempts');
