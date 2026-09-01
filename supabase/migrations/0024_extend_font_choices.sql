-- Mujeeb AI — 0024: four more reading fonts.
--
-- The CHECK constraint is one of the three gates that keep this an enum
-- rather than a font-family string (the others being the fixed list in the
-- UI and the zod enum in the server action), so it has to learn the new
-- values alongside them. Every added stack is device fonts only — nothing
-- is downloaded, and the CSP is untouched.

alter table public.profiles
  drop constraint if exists profiles_font_preference_check;

alter table public.profiles
  add constraint profiles_font_preference_check
  check (font_preference in (
    'system', 'grotesk', 'humanist', 'geometric', 'rounded',
    'serif', 'slab', 'mono', 'reading'
  ));
