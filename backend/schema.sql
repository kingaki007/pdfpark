CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_limits (
  key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
  error text, input_path text, output_path text
);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(created_at) WHERE status = 'queued';

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS input_path text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_path text;


ALTER TABLE users ADD COLUMN IF NOT EXISTS is_root boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS visitors (
  visitor_hash text PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  visits bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS visitors_last_seen ON visitors(last_seen);

-- Dormant subscription storage. No subscription/payment routes are mounted.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id text PRIMARY KEY, name text NOT NULL, entitlements jsonb NOT NULL DEFAULT '[]'
);
INSERT INTO subscription_plans(id,name,entitlements)
VALUES ('free','Free','["document-tools"]') ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'free' CHECK(status IN ('free','trialing','active','past_due','canceled')),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
