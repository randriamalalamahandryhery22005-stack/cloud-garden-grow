ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS birth_date text,
  ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.game_access ADD COLUMN IF NOT EXISTS price_amount numeric;