import { admin, authUser, handler, HttpError } from './_lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST { user_id } -> deletes that person's account and everything that is theirs (migration 0041 sets what goes with it).
// Platform admins only; nobody deletes their own account here, and the last platform admin can't be deleted.
export default handler('POST', async (req) => {
  const me = await authUser(req);
  const db = admin();
  const { data: pa } = await db.from('tt_platform_admins').select('user_id').eq('user_id', me.id).maybeSingle();
  if (!pa) throw new HttpError(403, 'Only platform admins can delete accounts');

  const id = String(req.body?.user_id ?? '');
  if (!UUID.test(id)) throw new HttpError(400, 'Which account? user_id is missing or not valid');
  if (id === me.id) throw new HttpError(400, "You can't delete your own account");
  const { data: target } = await db.from('tt_platform_admins').select('user_id').eq('user_id', id).maybeSingle();
  if (target) {
    const { count } = await db.from('tt_platform_admins').select('user_id', { count: 'exact', head: true });
    if ((count ?? 0) <= 1) throw new HttpError(400, 'There must be at least one platform admin');
  }

  // organizations they created stop naming them as creator first: the members guard keeps an organization's creator
  // as an active admin, which otherwise blocks removing their memberships along with the account
  const { error: orgErr } = await db.from('tt_organizations').update({ created_by: null }).eq('created_by', id);
  if (orgErr) throw new HttpError(500, `Couldn't release the organizations they created: ${orgErr.message}`.slice(0, 200));

  const { error } = await db.auth.admin.deleteUser(id);
  if (error) {
    if (/not found/i.test(error.message)) throw new HttpError(404, 'That account no longer exists');
    // Supabase only says "Database error deleting user"; the exact reason is in Supabase > Logs > Auth
    console.error('deleteUser failed', id, error.status, error.message);
    throw new HttpError(500, `Couldn't delete the account (${error.message}). Check that database updates 0041 and 0042 have run; the exact reason is in Supabase > Logs > Auth.`.slice(0, 300));
  }
  console.log('account deleted', { by: me.id, user: id });
  return { deleted: true };
});
