CREATE TABLE IF NOT EXISTS public.device_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, user_id)
);
GRANT SELECT, INSERT ON public.device_accounts TO authenticated;
GRANT ALL ON public.device_accounts TO service_role;
ALTER TABLE public.device_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "device_accounts_select_own" ON public.device_accounts;
CREATE POLICY "device_accounts_select_own" ON public.device_accounts FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "device_accounts_insert_own" ON public.device_accounts;
CREATE POLICY "device_accounts_insert_own" ON public.device_accounts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS device_accounts_device_idx ON public.device_accounts(device_id);

CREATE OR REPLACE FUNCTION public.device_account_count(_device_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(count(*), 0)::int FROM public.device_accounts WHERE device_id = _device_id;
$$;
GRANT EXECUTE ON FUNCTION public.device_account_count(text) TO anon, authenticated;