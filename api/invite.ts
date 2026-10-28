import { admin, authUser, handler, HttpError } from './_lib/http';

const ROLES = ['owner', 'admin', 'manager', 'employee'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { org_id, email, full_name?, role }            -> invite an employee
// POST { org_id, email, full_name?, client_contact_id } -> invite a client contact to the portal
export default handler('POST', async (req) => {
  const user = await authUser(req);
  const { org_id, email, full_name, role, client_contact_id } = req.body ?? {};
  if (typeof org_id !== 'string' || typeof email !== 'string' || !EMAIL.test(email)) throw new HttpError(400, 'Valid org_id and email required');
  const db = admin();

  // role comes from the database, never from the request
  const { data: me } = await db.from('tt_org_members').select('role').eq('org_id', org_id).eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!me) throw new HttpError(403, 'Not authorized');

  if (client_contact_id) {
    if (!['owner', 'admin', 'manager'].includes(me.role)) throw new HttpError(403, 'Not authorized');
    const { data: c } = await db.from('tt_client_contacts').select('id').eq('id', client_contact_id).eq('org_id', org_id).maybeSingle();
    if (!c) throw new HttpError(404, 'Contact not found');
  } else {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    if (!['owner', 'admin'].includes(me.role)) throw new HttpError(403, 'Not authorized');
    if (role === 'owner' && me.role !== 'owner') throw new HttpError(403, 'Only an owner can invite owners');
  }

  const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL, data: { full_name } });
  let uid = invited.data.user?.id;
  if (!uid) {
    // already registered: look the user up instead of failing
    const { data: p } = await db.from('tt_profiles').select('user_id').ilike('email', email).maybeSingle();
    uid = p?.user_id;
  }
  if (!uid) throw new HttpError(400, 'Could not invite that email');

  if (client_contact_id) {
    const { error } = await db.from('tt_client_contacts').update({ user_id: uid, portal_access: true }).eq('id', client_contact_id).eq('org_id', org_id);
    if (error) throw new HttpError(400, 'Could not link contact (is this user already linked to this client?)');
  } else {
    const { error } = await db.from('tt_org_members').upsert({ org_id, user_id: uid, role, active: true });
    if (error) throw new HttpError(400, 'Could not add member');
  }
  await db.from('tt_activity_logs').insert({
    org_id, entity_type: 'organization', entity_id: org_id, action: client_contact_id ? 'portal_invited' : 'member_invited',
    actor_id: user.id, detail: { role: role ?? 'portal' },
  });
  return { ok: true };
});
