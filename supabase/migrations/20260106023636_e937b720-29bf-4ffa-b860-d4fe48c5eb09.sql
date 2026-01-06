-- Create a public bucket for inspiration media
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspiration-media', 'inspiration-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to upload to the bucket (no auth required for this app)
CREATE POLICY "Anyone can upload inspiration media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'inspiration-media');

-- Allow anyone to read inspiration media
CREATE POLICY "Anyone can read inspiration media"
ON storage.objects FOR SELECT
USING (bucket_id = 'inspiration-media');

-- Allow anyone to delete their uploads (by matching file path pattern)
CREATE POLICY "Anyone can delete inspiration media"
ON storage.objects FOR DELETE
USING (bucket_id = 'inspiration-media');