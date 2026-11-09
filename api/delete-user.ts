import { admin, authUser, handler, HttpError, type Req } from './_lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sign-in level of the caller's token (aal2 = two-step sign-in done). The token was already verified by authUser. */
const aal = (req: Req) => {
  const t = String(req.headers.authorization ?? '').split('.')[1] ?? '';
  try { return JSON.parse(Buffer.from(t, 'base64url').toString()).aal as string; } catch { return 'aal1'; }
};

// POST { user_id } -> deletes that person's account and everything that is theirs (migration 0041 sets what goes with it).
// Platform admins: any account but their own (and not the last platform admin).
// Organization admins: an employee of their organization who belongs to no other organization, since the account goes everywhere.
export default handler('POST', async (req) => {
  const me = await authUser(req);
  const db = admin();
  const id = String(req.body?.user_id ?? '');
  if (!UUID.test(id)) throw new HttpError(400, 'Which account? user_id is missing or not valid');
  if (id === me.id) throw new HttpError(400, "You can't delete your own account");

  const isPA = async (u: string) => !!(await db.from('tt_platform_admins').select('user_id').eq('user_id', u).maybeSingle()).data;
  if (await isPA(me.id)) {
    if (await isPA(id)) {
      const { count } = await db.from('tt_platform_admins').select('user_id', { count: 'exact', head: true });
      if ((count ?? 0) <= 1) throw new HttpError(400, 'There must be at least one platform admin');
    }
  } else {
    // an organization admin: the person must be an employee of one of their organizations, and only of that one
    if (await isPA(id)) throw new HttpError(403, 'Only platform admins can delete a platform admin');
    const { data: theirs } = await db.from('tt_org_members').select('org_id, role').eq('user_id', id);
    if (!theirs?.length) throw new HttpError(403, 'Only platform admins can delete accounts that are in no organization');
    if (theirs.length > 1) throw new HttpError(403, 'This person is also in another organization. Remove them from yours instead; only a platform admin can delete their account.');
    const [{ org_id, role }] = theirs;
    if (role !== 'employee') throw new HttpError(403, 'Admins can delete employees only. Change their role first, or ask a platform admin.');
    const [{ data: mine }, { data: org }] = await Promise.all([
      db.from('tt_org_members').select('role, active').eq('org_id', org_id).eq('user_id', me.id).maybeSingle(),
      db.from('tt_organizations').select('*').eq('id', org_id).maybeSingle(),
    ]);
    if (!mine?.active || !['admin', 'owner'].includes(mine.role) || org?.status && org.status !== 'approved') throw new HttpError(403, 'Only an admin of their organization can delete this account');
    if (org?.require_admin_mfa && aal(req) !== 'aal2') throw new HttpError(403, 'Finish two-step sign-in first: this organization requires it for admins');
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
    throw new HttpError(500, `Couldn't delete the account (${error.message}). Check that database updates 0041 to 0044 have run; the exact reason is in Supabase > Logs > Auth.`.slice(0, 300));
  }
  console.log('account deleted', { by: me.id, user: id });
  return { deleted: true };
});
