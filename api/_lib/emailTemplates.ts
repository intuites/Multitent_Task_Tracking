// Styled task emails. Email clients ignore <style> and scripts, so everything is inline styles and tables.
export interface Ctx { org: string; tz: string; appUrl: string }
export interface HistoryRow { at: string; status: string; comment: string | null; user: string | null }
export interface TaskMail {
  id: string; title: string; description: string | null; status: string; priority: string;
  due_date: string | null; created_at: string; completed_at: string | null;
  department: string | null; assignees: string[]; createdBy: string | null; completedBy: string | null;
  lead: string | null; manager: string | null;
  history: HistoryRow[]; // newest first
}
export interface DigestRow { id: string; title: string; department: string | null; assignees: string[]; status: string; priority: string; due_date: string | null; created_at: string }
export interface Mail { subject: string; html: string; text: string }

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#111827', TEXT = '#374151', MUTED = '#6b7280', LINE = '#e5e7eb', BG = '#f3f4f6', SOFT = '#f9fafb';
const STATUS: Record<string, [string, string, string]> = { // label, text colour, background
  not_yet_started: ['Not Yet Started', '#374151', '#f3f4f6'], started: ['Started', '#1d4ed8', '#dbeafe'],
  pending: ['Pending', '#b45309', '#fef3c7'], escalation: ['Escalation', '#b91c1c', '#fee2e2'],
  completed_cycle: ['Completed this cycle', '#0f766e', '#ccfbf1'], completed: ['Completed Permanently', '#15803d', '#dcfce7'],
};
const PRIORITY: Record<string, string> = { low: '#6b7280', medium: '#2563eb', high: '#ea580c', urgent: '#dc2626' };

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const statusLabel = (s: string) => STATUS[s]?.[0] ?? cap(s.replace(/_/g, ' '));
export const fmtDate = (iso: string | null, tz: string) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtTime = (iso: string, tz: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz });
/** Whole days from `from` to `to` (never negative). */
export const daysBetween = (from: string, to: Date = new Date()) => Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 864e5));

const chip = (s: string) => { const [l, c, b] = STATUS[s] ?? [statusLabel(s), TEXT, BG]; return `<span style="padding:2px 9px;border-radius:9px;background:${b};color:${c};font-size:12px;font-weight:600;white-space:nowrap">${esc(l)}</span>`; };
const prio = (p: string) => `<span style="color:${PRIORITY[p] ?? TEXT};font-weight:600;">${esc(cap(p))}</span>`;
const p = (html: string, style = '') => `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:24px;color:${TEXT};${style}">${html}</p>`;
const button = (href: string, label: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;"><tr>
  <td bgcolor="${INK}" style="border-radius:8px;"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a></td>
</tr></table>`;
/** Label/value rows, like "Department: Software Developers". Empty values are left out. */
const facts = (rows: [string, string | null][]) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">${rows.filter(([, v]) => v).map(([k, v]) => `
  <tr><td style="padding:5px 16px 5px 0;font-family:${FONT};font-size:14px;color:${MUTED};white-space:nowrap;vertical-align:top;">${k}</td>
      <td style="padding:5px 0;font-family:${FONT};font-size:14px;color:${INK};vertical-align:top;">${v}</td></tr>`).join('')}
</table>`;
// cells inherit font and colour from the table, so a 100-row digest stays under Gmail's ~100 KB clipping limit
const th = (s: string) => `<th align="left" style="padding:10px 12px;font-size:12px;font-weight:600;color:${MUTED};background:${SOFT};border-bottom:1px solid ${LINE};">${s}</th>`;
const td = (s: string, extra = '') => `<td style="padding:10px 12px;border-bottom:1px solid ${LINE};${extra}">${s}</td>`;
const table = (heads: string[], rows: string[][]) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:8px;border-collapse:separate;font-family:${FONT};font-size:13px;line-height:19px;color:${TEXT};">
<tr valign="top">${heads.map(th).join('')}</tr>${rows.map((r) => `\n<tr valign="top">${r.join('')}</tr>`).join('')}
</table>`;
const h2 = (s: string) => `<h2 style="margin:28px 0 12px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">${s}</h2>`;

function layout(ctx: Ctx, heading: string, body: string, preheader: string) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px;">
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="32" height="32" align="center" bgcolor="${INK}" style="width:32px;height:32px;border-radius:8px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;">T</td>
        <td style="padding-left:10px;font-family:${FONT};font-size:16px;font-weight:700;color:${INK};">Taskify<span style="font-weight:400;color:${MUTED};"> for ${esc(ctx.org)}</span></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;font-weight:700;line-height:30px;color:${INK};">${heading}</h1>
      ${body}
    </td></tr>
    <tr><td align="center" style="padding:20px 16px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
      Sent by Taskify for ${esc(ctx.org)}. <a href="${esc(ctx.appUrl)}/notifications" target="_blank" style="color:${MUTED};">Email settings</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const historyTable = (t: TaskMail, ctx: Ctx) => {
  // newest first; the creation is always the last (oldest) row
  const rows = [...t.history, { at: t.created_at, status: 'created', comment: null, user: t.createdBy }];
  return table(['Date', 'Status', 'Comment', 'User'], rows.map((h) => [
    td(esc(fmtTime(h.at, ctx.tz)), 'white-space:nowrap;'), td(h.status === 'created' ? 'Created' : chip(h.status)), td(esc(h.comment ?? '')), td(esc(h.user ?? '')),
  ]));
};
const historyText = (t: TaskMail, ctx: Ctx) => [...t.history.map((h) => `${fmtTime(h.at, ctx.tz)}  ${statusLabel(h.status)}${h.comment ? ` (${h.comment})` : ''}${h.user ? ` by ${h.user}` : ''}`),
  `${fmtTime(t.created_at, ctx.tz)}  Created${t.createdBy ? ` by ${t.createdBy}` : ''}`].join('\n');
const link = (t: TaskMail, ctx: Ctx) => `${ctx.appUrl}/tasks/${t.id}`;

/** "You've been assigned a new task" (also CC'd people and team leads, by `intro`). */
export function taskCreated(t: TaskMail, ctx: Ctx, intro: string): Mail {
  const due = t.due_date ? fmtDate(t.due_date, ctx.tz) : null;
  const body = p(esc(intro)) + facts([
    ['Task', `<b>${esc(t.title)}</b>`], ['Department', t.department && esc(t.department)], ['Assigned to', t.assignees.length ? esc(t.assignees.join(', ')) : null],
    ['Priority', prio(t.priority)], ['Status', chip(t.status)], ['Due date', due], ['Created by', t.createdBy && esc(t.createdBy)],
    ['Lead', t.lead && esc(t.lead)], ['Manager', t.manager && esc(t.manager)],
  ]) + (t.description ? h2('Details') + p(esc(t.description).replace(/\n/g, '<br>'), 'white-space:normal;') : '') + button(link(t, ctx), 'Open task');
  return {
    subject: `New task: ${t.title}${due ? ` [Due ${due}]` : ''}`,
    html: layout(ctx, 'New task', body, intro),
    text: `${intro}\n\nTask: ${t.title}\nDepartment: ${t.department ?? '-'}\nPriority: ${cap(t.priority)}\nDue: ${due ?? '-'}\n${t.description ? `\n${t.description}\n` : ''}\nOpen: ${link(t, ctx)}`,
  };
}

/** The repeating reminder, sent on the task's frequency until it is completed. */
export function taskReminder(t: TaskMail, ctx: Ctx, now = new Date()): Mail {
  const days = daysBetween(t.created_at, now), created = fmtDate(t.created_at, ctx.tz);
  const overdue = t.due_date && new Date(t.due_date) < now;
  const body = facts([
    ['Department', t.department && esc(t.department)], ['Task', `<b>${esc(t.title)}</b>`], ['Current status', chip(t.status)],
    ['Priority', prio(t.priority)], ['Created on', created],
    ['Due date', t.due_date ? `${fmtDate(t.due_date, ctx.tz)}${overdue ? ` <span style="color:#dc2626;font-weight:600;">(${daysBetween(t.due_date, now)} days overdue)</span>` : ''}` : null],
    ['Pending since', `${days} day${days === 1 ? '' : 's'}`], ['Assigned to', t.assignees.length ? esc(t.assignees.join(', ')) : null],
  ]) + h2('Status history') + historyTable(t, ctx) + button(link(t, ctx), 'Update this task');
  return {
    subject: `${t.title} -> ${created} -> ${statusLabel(t.status)} since ${days} day${days === 1 ? '' : 's'}`,
    html: layout(ctx, 'Task reminder', body, `${statusLabel(t.status)} for ${days} days`),
    text: `Task reminder\n\nTask: ${t.title}\nDepartment: ${t.department ?? '-'}\nCurrent status: ${statusLabel(t.status)}\nPriority: ${cap(t.priority)}\nCreated on: ${created}\nPending since: ${days} days\n\nStatus history\n${historyText(t, ctx)}\n\nOpen: ${link(t, ctx)}`,
  };
}

/** Completed permanently: closed for good, with the full history (newest first). */
export function taskCompleted(t: TaskMail, ctx: Ctx): Mail {
  const due = t.due_date ? fmtDate(t.due_date, ctx.tz) : null;
  const done = t.completed_at ?? new Date().toISOString(), took = daysBetween(t.created_at, new Date(done));
  const body = facts([
    ['Completed by', t.completedBy && esc(t.completedBy)], ['Department', t.department && esc(t.department)], ['Task', `<b>${esc(t.title)}</b>`],
    ['Assigned to', t.assignees.length ? esc(t.assignees.join(', ')) : null], ['Due date', due], ['Status', chip('completed')],
    ['Created', esc(fmtTime(t.created_at, ctx.tz))], ['Completed', esc(fmtTime(done, ctx.tz))], ['Total duration', `${took} day${took === 1 ? '' : 's'}`],
  ]) + p('<b>This task is closed for good.</b> No further reminder emails will be sent.', `color:#15803d;margin-top:12px;`)
    + h2('Task activity history') + historyTable(t, ctx) + button(link(t, ctx), 'View task');
  return {
    subject: `${t.title} -> Completed Permanently${due ? ` [Due ${due}]` : ''}`,
    html: layout(ctx, '✅ Task completed', body, `${t.title} is closed for good`),
    text: `Task completed\n\nTask: ${t.title}\nCompleted by: ${t.completedBy ?? '-'}\nDepartment: ${t.department ?? '-'}\nTotal duration: ${took} days\n\nThis task is closed for good. No further reminder emails will be sent.\n\nActivity history\n${historyText(t, ctx)}\n\nOpen: ${link(t, ctx)}`,
  };
}

/** Any other notification (status change, comment…): its title and text, styled. */
export function generic(subject: string, text: string, href: string | null, ctx: Ctx): Mail {
  const url = href ? `${ctx.appUrl}${href}` : ctx.appUrl;
  const body = (text && text !== subject ? p(esc(text).replace(/\n/g, '<br>')) : '') + button(url, 'Open in Taskify');
  return { subject, html: layout(ctx, esc(subject), body, text || subject), text: `${text || subject}\n\n${url}` };
}

/** Sent after sign-up: the one link that confirms the email address and signs them in. */
export function confirmSignup(name: string, link: string, appUrl: string): Mail {
  const subject = 'Confirm your Taskify account';
  const body = p(`Hi ${esc(name)}, confirm this is your email address to finish creating your account.`) + button(link, 'Confirm my email')
    + p('If you didn’t sign up for Taskify, ignore this email.', `color:${MUTED};font-size:13px;margin-top:16px;`);
  return { subject, html: layout({ org: name, tz: 'UTC', appUrl }, subject, body, subject), text: `Hi ${name}, confirm your email to finish creating your Taskify account:\n\n${link}` };
}

const DIGEST_MAX = 100; // Gmail clips messages over ~100 KB; past this, the rest is a link
/** Midday or end-of-day digest: open tasks grouped by department, overdue first. */
export function digest(kind: 'midday' | 'eod', rows: DigestRow[], counts: { open: number; overdue: number; dueToday: number; doneToday: number },
  ctx: Ctx, scope: string, now = new Date()): Mail {
  const name = kind === 'midday' ? 'Midday' : 'End of day', day = fmtDate(now.toISOString(), ctx.tz);
  const late = (r: DigestRow) => !!r.due_date && new Date(r.due_date) < now;
  const sorted = [...rows].sort((a, b) => Number(late(b)) - Number(late(a)) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const shown = sorted.slice(0, DIGEST_MAX);
  const groups = new Map<string, DigestRow[]>();
  for (const r of shown) { const k = r.department ?? 'No department'; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const tile = (n: number, label: string, color = INK) => `<td width="25%" style="padding:12px;border:1px solid ${LINE};border-radius:8px;background:${SOFT};text-align:center;">
    <div style="font-family:${FONT};font-size:24px;font-weight:700;color:${color};">${n}</div><div style="font-family:${FONT};font-size:12px;color:${MUTED};">${label}</div></td>`;
  const tiles = `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="margin:0 -6px 8px;"><tr>
    ${tile(counts.open, 'Open')}${tile(counts.overdue, 'Overdue', counts.overdue ? '#dc2626' : INK)}${tile(counts.dueToday, 'Due today')}${tile(counts.doneToday, 'Completed today', '#15803d')}</tr></table>`;
  const sections = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dept, list]) => h2(`${esc(dept)} <span style="font-weight:400;color:${MUTED};">(${list.length})</span>`)
    + table(['Task', 'Assigned to', 'Status', 'Priority', 'Due', 'Open for'], list.map((r) => [
      td(`<a href="${esc(`${ctx.appUrl}/tasks/${r.id}`)}" style="color:${INK};font-weight:600;text-decoration:none">${esc(r.title)}</a>`),
      td(esc(r.assignees.join(', ') || '—')), td(chip(r.status)), td(prio(r.priority)),
      td(r.due_date ? `${fmtDate(r.due_date, ctx.tz)}${late(r) ? `<br><span style="color:#dc2626;font-size:12px;">${daysBetween(r.due_date, now)}d overdue</span>` : ''}` : '—', 'white-space:nowrap;'),
      td(`${daysBetween(r.created_at, now)}d`, 'white-space:nowrap;'),
    ]))).join('');
  const more = rows.length > shown.length ? p(`Showing ${shown.length} of ${rows.length} open tasks. <a href="${esc(ctx.appUrl)}/tasks" style="color:${INK};">See them all in Taskify</a>.`, 'margin-top:16px;') : '';
  const body = p(`${esc(scope)} &middot; ${esc(day)}. Click a task to open it.`, `color:${MUTED};font-size:14px;`) + tiles
    + (rows.length ? sections : p('No open tasks. Nice work.')) + more + button(`${ctx.appUrl}/tasks`, 'Open all tasks');
  return {
    subject: `[Task Digest] ${name} - ${day} - ${counts.open} open, ${counts.overdue} overdue`,
    html: layout(ctx, `${name} digest`, body, `${counts.open} open, ${counts.overdue} overdue`),
    text: `${name} digest - ${day}\n${scope}\nOpen: ${counts.open}, overdue: ${counts.overdue}, due today: ${counts.dueToday}, completed today: ${counts.doneToday}\n\n`
      + shown.map((r) => `- ${r.title} [${r.department ?? 'No department'}] ${statusLabel(r.status)}, due ${fmtDate(r.due_date, ctx.tz)}${late(r) ? ' (overdue)' : ''}`).join('\n')
      + `\n\n${ctx.appUrl}/tasks`,
  };
}
