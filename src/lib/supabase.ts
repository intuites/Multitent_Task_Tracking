import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const configured = !!url && !!key;
// placeholder values keep the app rendering (with a setup notice) until .env.local is filled in
export const supabase = createClient(url || 'http://localhost', key || 'missing');
