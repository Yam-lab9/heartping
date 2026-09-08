import { createClient } from '@supabase/supabase-js';

// Server-only: never imported by public/ or copied into the Android assets.
export function createStore() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let url;
  try { url = new URL(process.env.SUPABASE_URL); } catch {
    throw new Error('SUPABASE_URL must be a valid Supabase project URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project origin.');
  }
  if (!key?.trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required on the server.');
  const client = createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }) }
  });
  return async function call(action, userId = '', body = {}, newSession = false) {
    let result, error;
    try {
      ({ data: result, error } = await client.rpc('heartping_api', {
        p_action: action, p_user_id: userId, p_body: body, p_new_session: newSession
      }).abortSignal(AbortSignal.timeout(10000)));
    } catch { /* Never log credentials, raw database errors, or request bodies. */ }
    if (error || !result || !Number.isInteger(result.status) ||
        (result.status === 200 ? !result.data : typeof result.error !== 'string')) {
      throw new Error('Supabase persistence request failed.');
    }
    return result;
  };
}
