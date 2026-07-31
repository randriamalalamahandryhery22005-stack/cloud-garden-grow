CREATE OR REPLACE FUNCTION public.__import_exec(sql text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE sql; END; $$;
REVOKE ALL ON FUNCTION public.__import_exec(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.__import_exec(text) TO sandbox_exec;