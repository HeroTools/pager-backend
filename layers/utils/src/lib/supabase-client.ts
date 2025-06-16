import { createClient } from "@supabase/supabase-js";

const supabasePrivateKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabasePrivateKey)
  throw new Error(`Expected env var SUPABASE_SERVICE_ROLE_KEY`);

const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) throw new Error(`Expected env var SUPABASE_URL`);

const supabase = createClient(supabaseUrl, supabasePrivateKey);

export { supabase };
