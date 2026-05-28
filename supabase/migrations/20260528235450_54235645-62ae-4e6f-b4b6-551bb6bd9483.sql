-- Remove unrestricted public DELETE on inspiration-media (no client deletion needed; service_role bypasses RLS)
DROP POLICY IF EXISTS "Anyone can delete inspiration media" ON storage.objects;

-- Remove broad SELECT policy that enables listing all files in the bucket.
-- Files remain accessible via their public URLs because the bucket is public.
DROP POLICY IF EXISTS "Anyone can read inspiration media" ON storage.objects;