import { supabase } from './supabase';

/** Why this file can't be a profile photo, or null if it can. The bucket allows the same types and size (migration 0010). */
export function photoProblem(file: File): string | null {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return 'Use a PNG, JPG, WebP or GIF image.';
  if (file.size > 2 * 1024 * 1024) return 'Photos can be up to 2 MB.';
  return null;
}

/** Uploads into the person's own photo folder and returns its public address. */
export async function uploadPhoto(userId: string, file: File): Promise<string> {
  // a new file name each time, so browsers don't keep showing the cached old photo
  const path = `${userId}/avatar-${Date.now()}.${file.type.split('/')[1]}`;
  const up = await supabase.storage.from('tt-avatars').upload(path, file, { upsert: false, contentType: file.type });
  if (up.error) throw new Error(/bucket|not found/i.test(up.error.message) ? 'Photo upload needs the database update (migration 0010) first.' : up.error.message);
  return supabase.storage.from('tt-avatars').getPublicUrl(path).data.publicUrl;
}

/** Deletes a photo file that is no longer used (best effort: a leftover file is harmless). */
export async function deletePhotoFile(url?: string | null) {
  const path = String(url ?? '').split('/tt-avatars/')[1];
  if (path) await supabase.storage.from('tt-avatars').remove([path]);
}
