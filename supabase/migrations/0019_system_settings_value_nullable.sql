-- Mujeeb AI — 0019: an optional setting has to be clearable.
--
-- `system_settings.value` was `jsonb NOT NULL`. `announcement` is
-- optional: its validator accepts `null`, and the console sends `null`
-- when an operator empties the field. PostgREST turns that into SQL NULL,
-- which the NOT NULL constraint rejected — so a banner could be published
-- and then never taken down, with the console reporting only a generic
-- "couldn't save that".
--
-- Found by publishing a test announcement during the security audit and
-- then being unable to remove it.
--
-- Making the column nullable is the honest shape: "unset" is a real state
-- for an optional setting, distinct from "set to an empty string". Every
-- reader already treats null as absent and falls back to
-- `SETTING_DEFAULTS`, so a required setting cannot end up silently empty
-- at runtime as a result of this.

alter table public.system_settings alter column value drop not null;

comment on column public.system_settings.value is
  'Setting value as jsonb. NULL means unset — readers fall back to SETTING_DEFAULTS. Required for optional settings such as announcement, which must be clearable.';

update public.system_settings set value = null where key = 'announcement';
