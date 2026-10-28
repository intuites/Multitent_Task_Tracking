import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const configured = !!url && !!key;
// Read before supabase-js consumes the URL hash: reset and invite links must end on a set-password screen.
export const authLinkType = new URLSearchParams(window.location.hash.slice(1)).get('type');
// placeholder values keep the app rendering (with a setup notice) until .env.local is filled in
export const supabase = createClient(url || 'http://localhost', key || 'missing');
