import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Bridges the Clerk session into Supabase's Third-Party Auth so RLS policies can see the
// caller's identity (auth.jwt()). supabase.js is a module-level singleton with no access to
// React/Clerk context, so this reads the live token from the global `window.Clerk` instance
// that ClerkProvider exposes, rather than requiring every `import { supabase }` call site to
// change. accessToken is a lazy per-request callback, so it's fine that Clerk hasn't mounted
// yet when this module first loads — by the time any real query fires, it has.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  async accessToken() {
    try {
      return (await window.Clerk?.session?.getToken()) ?? null
    } catch {
      return null
    }
  },
})
export default supabase
