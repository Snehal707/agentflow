CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS blocked_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS require_confirmation_above numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_allowed_recipients_array'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_allowed_recipients_array
      CHECK (jsonb_typeof(allowed_recipients) = 'array') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_blocked_recipients_array'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_blocked_recipients_array
      CHECK (jsonb_typeof(blocked_recipients) = 'array') NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar NOT NULL,
  name varchar NOT NULL,
  address varchar NOT NULL,
  label varchar,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE (wallet_address, name)
);

CREATE INDEX IF NOT EXISTS idx_contacts_wallet_address
  ON contacts (wallet_address);

CREATE INDEX IF NOT EXISTS idx_contacts_wallet_name
  ON contacts (wallet_address, name);
