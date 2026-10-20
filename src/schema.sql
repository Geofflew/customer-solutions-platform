-- Acme Analytics customer-success platform. Every table is synthetic; scripts/generate.ts fills it.
DROP SCHEMA IF EXISTS cs CASCADE;
CREATE SCHEMA cs;
SET search_path = cs;

CREATE TABLE staff (name text PRIMARY KEY, role text NOT NULL);           -- our own team
CREATE TABLE accounts (
  account_id int PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner text REFERENCES staff,          -- NULL = nobody owns it
  phase text NOT NULL CHECK (phase IN ('Kickoff','Setup','Training','Pre-live','Live')),
  kickoff_date date,
  integration text NOT NULL CHECK (integration IN ('erp','import')),
  addons text[] NOT NULL DEFAULT '{}',
  renewal_date date NOT NULL,
  recordings_enabled boolean NOT NULL, -- call recordings cover this account
  seats_total int NOT NULL,
  seats_active int NOT NULL,
  admin_idle_days int NOT NULL
);
-- A feature switched off or snoozed for one account, with the reason a person wrote.
CREATE TABLE feature_settings (
  account_id int REFERENCES accounts,
  feature text NOT NULL CHECK (feature IN ('checklist','reconciliation','variance')),
  enabled boolean NOT NULL,
  snoozed_until date,
  reason text NOT NULL,
  PRIMARY KEY (account_id, feature)
);
-- Completed over total, per feature and closed month.
CREATE TABLE usage_periods (
  account_id int REFERENCES accounts,
  period date NOT NULL,                 -- first day of the month
  feature text NOT NULL,
  completed int NOT NULL,
  total int NOT NULL,
  PRIMARY KEY (account_id, period, feature)
);
CREATE TABLE escalations (id serial PRIMARY KEY, account_id int REFERENCES accounts, opened_on date NOT NULL, title text NOT NULL);
CREATE TABLE complaints (id serial PRIMARY KEY, account_id int REFERENCES accounts, opened_on date NOT NULL, severity text NOT NULL, title text NOT NULL);
CREATE TABLE contacts (account_id int REFERENCES accounts, name text NOT NULL, title text NOT NULL, tickets_90d int NOT NULL, PRIMARY KEY (account_id, name));
CREATE TABLE meetings (id serial PRIMARY KEY, account_id int REFERENCES accounts, held_on date NOT NULL, attendee text NOT NULL, attendee_title text NOT NULL);
CREATE TABLE call_mentions (id serial PRIMARY KEY, account_id int REFERENCES accounts, call_date date NOT NULL, name text NOT NULL, topic text);
CREATE TABLE notes (id serial PRIMARY KEY, account_id int REFERENCES accounts, author text NOT NULL, written_on date NOT NULL, body text NOT NULL);
CREATE TABLE status_notes (account_id int REFERENCES accounts, written_on date NOT NULL, author text NOT NULL, note text NOT NULL, next_step text, PRIMARY KEY (account_id, written_on));

-- Weekly activation score snapshots, written by scripts/scores.ts.
CREATE TABLE activation_scores (account_id int REFERENCES accounts, as_of date NOT NULL, score numeric, breakdown jsonb NOT NULL, PRIMARY KEY (account_id, as_of));

-- Segments: a saved rule, the member list someone last accepted, and an append-only override log.
CREATE TABLE segments (segment_id text PRIMARY KEY, name text NOT NULL, rule jsonb NOT NULL, baseline_members int[], reviewed_by text, reviewed_on date);
CREATE TABLE segment_overrides (id serial PRIMARY KEY, segment_id text REFERENCES segments, account_id int REFERENCES accounts, action text NOT NULL CHECK (action IN ('include','exclude','clear')), by_person text NOT NULL, on_date date NOT NULL, reason text NOT NULL);

-- Labelled past snapshots for the churn backtest: features then, and whether the account left.
CREATE TABLE churn_history (snapshot_id int PRIMARY KEY, features jsonb NOT NULL, notes jsonb NOT NULL, churned boolean NOT NULL);

-- The bot: what it proposed, and what was applied.
CREATE TABLE proposals (
  seq bigserial UNIQUE,                 -- ids come from a sequence: two proposes at once never collide
  proposal_id text PRIMARY KEY GENERATED ALWAYS AS ('P-' || lpad(seq::text, 4, '0')) STORED,
  requested_by text NOT NULL,
  thread_id text NOT NULL,              -- the chat thread the proposal was shown in
  account_id int REFERENCES accounts,
  changes jsonb NOT NULL,               -- [{role, person}], exactly what the person was shown
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','refused','expired')),
  created_on date NOT NULL,
  expires_on date NOT NULL
);
-- A role can have more than one holder (two onboarding leads), so a row is one person in one role.
CREATE TABLE assignments (account_id int REFERENCES accounts, role text NOT NULL, person text NOT NULL, proposal_id text, PRIMARY KEY (account_id, role, person));
