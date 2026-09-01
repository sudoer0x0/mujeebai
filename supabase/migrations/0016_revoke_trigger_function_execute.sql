-- Mujeeb AI — 0016: trigger functions must not be reachable as RPCs.
--
-- Flagged by the Supabase security linter
-- (anon_security_definer_function_executable): both of these are
-- SECURITY DEFINER trigger functions living in `public`, which PostgREST
-- exposes at /rest/v1/rpc/<name> because functions carry a default
-- EXECUTE grant to PUBLIC.
--
-- Calling a plpgsql trigger function outside a trigger raises "trigger
-- functions can only be called as triggers", so practical exploitability
-- is low. But a SECURITY DEFINER function that no client has any reason
-- to call should not be callable by clients — revoking is free and
-- removes the question.
--
-- Triggers keep working: the trigger executor does not consult EXECUTE
-- grants.
--
-- `public.admin_dashboard_snapshot()` is deliberately left callable by
-- `authenticated`. It is the one SECURITY DEFINER function clients are
-- meant to call, and it authorizes its caller in its first statement —
-- verified by test: a non-staff account receives 42501.

revoke all on function public.protect_staff_onboarding_columns() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
