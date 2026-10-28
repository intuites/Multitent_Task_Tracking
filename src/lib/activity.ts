import { supabase } from './supabase';

export async function logActivity(orgId: string, userId: string, entityType: string, entityId: string, action: string, detail: object = {}) {
  await supabase.from('tt_activity_logs').insert({ org_id: orgId, actor_id: userId, entity_type: entityType, entity_id: entityId, action, detail });
}
