-- ============================================================
-- Migration 047 — onboarding wizard completion flag
-- ============================================================
-- Why this exists:
--   First-time users sign in and land on an empty Feed tab — no
--   followed artists, no collection, no idea what the app does
--   beyond 'looks dark and metal'. Drop-off here is enormous.
--   The Onboarding wizard (3-step modal) explains the value
--   proposition, prompts a Discogs connect, and seeds a starter
--   set of followed artists so the Feed populates immediately.
--
--   This flag stops the wizard from re-firing on every app open.
--   Once the user completes (or explicitly skips) the wizard,
--   we set it to true and never show the wizard again.
--
-- Schema:
--   onboarding_completed boolean NOT NULL DEFAULT false
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
