// Generate a one-time sign-in link for any user (admin impersonation).
// Usage:  node --env-file=.env scripts/magic-link.mjs user@example.com
// The link is single-use and expires in ~1 hour. Open it in a private/
// incognito window so it doesn't replace your own session.
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env scripts/magic-link.mjs <email>");
  process.exit(1);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error) { console.error(error.message); process.exit(1); }
console.log(data.properties.action_link);
