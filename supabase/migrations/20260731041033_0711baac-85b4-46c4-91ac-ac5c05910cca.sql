DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;
CREATE POLICY "Users can upload payment proofs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can view their own proofs" ON storage.objects;
CREATE POLICY "Users can view their own proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update their own proofs" ON storage.objects;
CREATE POLICY "Users can update their own proofs" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete their own proofs" ON storage.objects;
CREATE POLICY "Users can delete their own proofs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

DROP POLICY IF EXISTS "Admins can view all proofs" ON storage.objects;
CREATE POLICY "Admins can view all proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "chat_files_read" ON storage.objects;
CREATE POLICY "chat_files_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-files');

DROP POLICY IF EXISTS "chat_files_upload_own" ON storage.objects;
CREATE POLICY "chat_files_upload_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "chat_files_update_own" ON storage.objects;
CREATE POLICY "chat_files_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'chat-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "chat_files_delete_own" ON storage.objects;
CREATE POLICY "chat_files_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-files' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));

DROP POLICY IF EXISTS "gen_store_read" ON storage.objects;
CREATE POLICY "gen_store_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'gen-store');

DROP POLICY IF EXISTS "gen_store_admin_write" ON storage.objects;
CREATE POLICY "gen_store_admin_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gen-store' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "gen_store_admin_update" ON storage.objects;
CREATE POLICY "gen_store_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'gen-store' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "gen_store_admin_delete" ON storage.objects;
CREATE POLICY "gen_store_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gen-store' AND public.has_role(auth.uid(), 'admin'));