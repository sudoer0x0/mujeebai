-- Mujeeb AI — 0011: relocate pg_trgm out of the public schema.
--
-- 0008 installed pg_trgm with a bare `create extension`, which put it in
-- `public` and therefore into the schema PostgREST exposes. Supabase
-- provisions an `extensions` schema for exactly this, and every role's
-- search_path already includes it, so the gin_trgm_ops operator classes
-- backing the search indexes keep resolving after the move.
create schema if not exists extensions;
grant usage on schema extensions to authenticated, anon, service_role;

alter extension pg_trgm set schema extensions;
