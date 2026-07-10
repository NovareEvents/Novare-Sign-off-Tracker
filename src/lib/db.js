import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "in your .env file (see .env.example) or in your Vercel project's Environment Variables."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseKey || "");

// Mimics the shape of the window.storage API the app was originally built
// against (get/set returning { key, value }, value as a JSON string), so the
// rest of the app's code — all the JSON.parse(result.value) calls — didn't
// need to change. Everything here is "shared": every admin and trainee reads
// and writes the same rows in the novare_kv table.
export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("novare_kv")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value };
  },

  async set(key, value) {
    const { error } = await supabase
      .from("novare_kv")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value };
  },
};

// Personal, per-device preference (which trainee this browser last signed in
// as). This never needs to be shared between people, so it just uses the
// browser's real localStorage instead of the database.
export const localPref = {
  get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? { key, value: raw } : null;
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};
