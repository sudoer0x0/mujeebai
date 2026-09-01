-- Mujeeb AI — 0018: reading font preference.
--
-- ## Why an enum and not a font name
--
-- The chosen value ends up in a `data-font` attribute on <html>, where it
-- selects a stack defined in `globals.css`. Storing a free-text
-- font-family would mean a user-supplied string reaching the page's
-- styling, which is a CSS injection question nobody should have to think
-- about for a preference this small.
--
-- Three gates, deliberately redundant: a fixed list in the UI, a zod enum
-- in the server action, and this CHECK constraint. The database is the one
-- that still holds if a future caller forgets the other two.
--
-- ## Why no webfonts
--
-- Every stack is built from fonts already on the device. Nothing is
-- fetched, so this cannot turn into a request to a font CDN — which would
-- both leak the reader's IP to a third party and require loosening the
-- CSP's `font-src 'self' data:`.

alter table public.profiles
  add column if not exists font_preference text not null default 'system';

alter table public.profiles
  drop constraint if exists profiles_font_preference_check;

alter table public.profiles
  add constraint profiles_font_preference_check
  check (font_preference in ('system', 'grotesk', 'humanist', 'serif', 'mono'));

comment on column public.profiles.font_preference is
  'Reading font. One of a fixed set of device font stacks — never a user-supplied font-family.';
