import { admin, authUser, handler, HttpError } from './_lib/http.js';

const ROLES = ['admin', 'employee'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { org_id, email, full_name?, role } -> invite an admin or employee
export default handler('POST', async (req) => {
  const user = await authUser(req);
  const { org_id, email, full_name, role } = req.body ?? {};
  if (typeof org_id !== 'string' || typeof email !== 'string' || !EMAIL.test(email)) throw new HttpError(400, 'Valid org_id and email required');
  const db = admin();

  // role comes from the database, never from the request
  let { data: me } = await db.from('tt_org_members').select('role').eq('org_id', org_id).eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!me) {
    // platform admins control every existing organization without being a member of it
    const [{ data: pa }, { data: org }] = await Promise.all([
      db.from('tt_platform_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
      db.from('tt_organizations').select('id').eq('id', org_id).maybeSingle(),
    ]);
    if (pa && org) me = { role: 'owner' };
  }
  if (!me) throw new HttpError(403, 'Not authorized');

  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  if (!['owner', 'admin'].includes(me.role)) throw new HttpError(403, 'Not authorized');

  const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL, data: { full_name } });
  let uid = invited.data.user?.id;
  if (!uid) {
    // already registered: find them by their login email (exact match), never by the editable profile email
    const { data: found } = await db.rpc('tt_user_id_by_email', { p_email: email });
    uid = found ?? undefined;
  }
  if (!uid) throw new HttpError(400, 'Could not invite that email');

  // inviting is for new people; roles and deactivation are changed on the person's page
  const { data: existing } = await db.from('tt_org_members').select('user_id').eq('org_id', org_id).eq('user_id', uid).maybeSingle();
  if (existing) throw new HttpError(409, 'This person is already in this organization. Change their role or reactivate them on their page.');

  const { error } = await db.from('tt_org_members').insert({ org_id, user_id: uid, role, active: true });
  if (error) throw new HttpError(400, 'Could not add member');
  await db.from('tt_activity_logs').insert({
    org_id, entity_type: 'organization', entity_id: org_id, action: 'member_invited',
    actor_id: user.id, detail: { role },
  });
  return { ok: true };
});
