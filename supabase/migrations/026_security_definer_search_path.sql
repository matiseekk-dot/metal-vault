-- ============================================================
-- Metal Vault — harden SECURITY DEFINER functions with explicit search_path
-- ============================================================
-- Supabase Database Advisor flags SECURITY DEFINER functions that
-- don't pin their search_path. Without it, an attacker who can
-- create objects in `public` (or any schema earlier on the resolver
-- path) could shadow `auth.users`, the trigger table, etc — the
-- function then runs the attacker's code with elevated privileges.
--
-- Fix: ALTER each existing SECURITY DEFINER function to set
-- `search_path = public, pg_temp`. Keeps things simple — no other
-- schemas referenced. pg_temp is included because Postgres always
-- searches it first for unqualified identifiers regardless.
--
-- Functions covered (all defined in earlier migrations):
--   • handle_new_user()                — 001_schema.sql:28
--   • handle_new_user() (replacement)  — 003_fix_trigger.sql:18 (idempotent)
--   • sync_collection_play_stats()     — 024_listen_logs.sql:80
-- ============================================================

ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.sync_collection_play_stats()
  SET search_path = public, pg_temp;
