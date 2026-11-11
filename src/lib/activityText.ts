// Turns an activity-log row into a plain sentence ("moved Fix login from Not Yet Started to In Progress") and groups rows by day.
import { label } from './ui';

export interface LogRow { id: string; created_at: string; actor_id: string | null; entity_type: string; entity_id: string; action: string; detail: Record<string, any> | null }
export type Category = 'task' | 'people' | 'org' | 'work';
/** The sentence after the actor's name: `verb`, then an optional linked `target`, then `rest`. */
export interface Sentence { verb: string; target?: { text: string; to: string }; rest?: string; category: Category }

const UNIT: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const quote = (s?: string) => (s ? ` “${s}”` : '');
const lower = (s: string) => label(s).toLowerCase();

export function describe(r: LogRow, person: (id?: string | null) => string, taskTitle: (id: string) => string | undefined): Sentence {
  const d = r.detail ?? {};
  if (r.entity_type === 'task') {
    const title = taskTitle(r.entity_id); // undefined once the task is deleted: no link to a missing page
    const target = { text: title ?? 'a task', to: title === undefined ? '' : `/tasks/${r.entity_id}` };
    const t = (verb: string, rest?: string): Sentence => ({ verb, target, rest, category: 'task' });
    switch (r.action) {
      case 'created': return t('created');
      case 'created_from_template': return t('created', ` from template${quote(d.template)}`);
      case 'edited': return t('edited');
      case 'status_changed': return t('moved', d.from && d.to ? ` from ${label(d.from)} to ${label(d.to)}` : d.to ? ` to ${label(d.to)}` : undefined);
      case 'assignee_added': return t(`assigned ${person(d.user)} to`);
      case 'assignee_removed': return t(`removed ${person(d.user)} from`);
      case 'approval_requested': return t('asked for approval on');
      case 'approval_approved': return t('approved');
      case 'approval_rejected': return t('sent back');
      // a pause date is a calendar day: read it as local midnight so it never shows the day before
      case 'paused': return t('paused', d.until ? ` until ${new Date(`${d.until}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : undefined);
      case 'resumed': return t('resumed', d.auto ? ' on schedule' : undefined);
      case 'recurrence_set': {
        const unit = UNIT[d.frequency] ?? d.frequency;
        return t('set', unit ? ` to repeat every ${Number(d.every) > 1 ? `${d.every} ${unit}s` : unit}` : ' to repeat');
      }
      case 'cycle_set': return t('set', d.frequency ? ` to a ${lower(d.frequency)} cycle` : ' to a cycle');
      case 'dependency_added': return t('marked', ' as waiting on another task');
      default: return t(`${lower(r.action)} on`);
    }
  }
  if (r.entity_type === 'organization' || r.entity_type === 'member') {
    const who = person(r.entity_type === 'member' ? r.entity_id : d.user);
    switch (r.action) {
      case 'settings_updated': return { verb: 'updated organization settings', category: 'org' };
      case 'created': return { verb: 'created the organization', category: 'org' };
      case 'approved': return { verb: 'approved the organization', category: 'org' };
      case 'rejected': return { verb: 'rejected the organization', category: 'org' };
      case 'member_invited': return { verb: `invited a new ${d.role ? lower(d.role) : 'member'}`, category: 'people' };
      case 'portal_invited': return { verb: 'invited a client portal user', category: 'people' };
      case 'role_changed': return { verb: `changed ${who}’s role${d.to ? ` to ${label(d.to)}` : ''}`, category: 'people' };
      case 'member_deactivated': return { verb: `deactivated ${who}`, category: 'people' };
      case 'member_activated': return { verb: `reactivated ${who}`, category: 'people' };
      case 'photo_changed_by_admin': return { verb: `changed ${who}’s profile photo`, category: 'people' };
      case 'photo_removed_by_admin': return { verb: `removed ${who}’s profile photo`, category: 'people' };
      case 'profile_edited_by_admin': return { verb: `edited ${who}’s details`, category: 'people' };
      default: return { verb: r.entity_type === 'member' ? `${lower(r.action)} for ${who}` : lower(r.action), category: r.entity_type === 'member' ? 'people' : 'org' };
    }
  }
  const thing = r.entity_type === 'project' ? 'project' : r.entity_type === 'client' ? 'client' : lower(r.entity_type);
  const w = (verb: string): Sentence => ({ verb, category: 'work' });
  switch (r.action) {
    case 'created': return w(r.entity_type === 'client' ? 'added a client' : `created a ${thing}`);
    case 'edited': return w(`edited a ${thing}`);
    case 'deleted': return w(`deleted ${thing}${quote(d.name)}`);
    case 'status_changed': return w(`moved a ${thing}${d.from && d.to ? ` from ${label(d.from)} to ${label(d.to)}` : ''}`);
    case 'milestone_completed': return w(`completed milestone${quote(d.title)}`);
    case 'milestone_reopened': return w(`reopened milestone${quote(d.title)}`);
    case 'progress_mode_changed': return w(`set a project’s progress to follow ${d.to ? lower(d.to) : 'a new rule'}`);
    case 'client_visibility_changed': return w(d.visible ? 'showed a project to its client' : 'hid a project from its client');
    case 'contact_added': return w('added a client contact');
    case 'sub_client_added': return w(`added sub-client${quote(d.name)}`);
    default: return w(`${lower(r.action)} on a ${thing}`);
  }
}

/** Which entity types each filter shows (server-side, so paging stays right). */
export const FILTERS: { key: string; name: string; types: string[] }[] = [
  { key: '', name: 'All', types: [] },
  { key: 'task', name: 'Tasks', types: ['task'] },
  { key: 'org', name: 'Organization & people', types: ['organization', 'member'] },
  // projects and clients were removed (0024); their old entries still show under All
];

/** Back-to-back rows by the same person doing the same thing to the same item fold into one, with a count. */
export function fold(rows: LogRow[]) {
  const out: { row: LogRow; count: number }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.row.actor_id === r.actor_id && last.row.action === r.action && last.row.entity_id === r.entity_id
      && JSON.stringify(last.row.detail ?? {}) === JSON.stringify(r.detail ?? {})) last.count++;
    else out.push({ row: r, count: 1 });
  }
  return out;
}

/** "Today", "Yesterday" or "Monday, November 2" in `zone`; rows keep their order. */
export function byDay<T>(items: T[], at: (t: T) => string, zone: string, now = new Date()) {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: zone });
  const today = key(now), yesterday = key(new Date(now.getTime() - 864e5));
  const groups: { key: string; title: string; items: T[] }[] = [];
  for (const it of items) {
    const d = new Date(at(it)), k = key(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) {
      const title = k === today ? 'Today' : k === yesterday ? 'Yesterday'
        : d.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', ...(k.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
      g = { key: k, title, items: [] }; groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}
