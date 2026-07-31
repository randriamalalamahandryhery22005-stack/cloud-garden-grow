GRANT ALL ON SCHEMA public TO sandbox_exec;
GRANT anon, authenticated, service_role TO sandbox_exec;
ALTER ROLE sandbox_exec SET search_path = public;