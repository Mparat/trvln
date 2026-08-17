// Re-export the canonical Supabase client (configured with auth persistence).
export { supabase } from '@/integrations/supabase/client';

import { supabase as client } from '@/integrations/supabase/client';

// Headers for edge-function calls: always the anon apikey, plus the signed-in
// user's access token so functions can attribute requests to a user and apply
// per-user gating. Signed-out callers simply get no Authorization header.
export async function functionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  const { data: { session } } = await client.auth.getSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}
