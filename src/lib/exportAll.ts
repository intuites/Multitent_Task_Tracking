// Organization settings → Data: everything one organization holds, as one Excel workbook or one PDF.
import { supabase } from './supabase';
import { fetchAll, fileStamp, fmtTime, label, loadPeople, saveBlob } from './ui';
import { buildXlsx, type Cell } from './xlsx';
import { printReport } from './printReport';

const PDF_ROWS = 500; // history and activity in the PDF: the newest rows only, so it stays printable
const head = (cols: string[]): Cell[] => cols.map((c) => ({ v: c, s: 'head' as const }));
const when = (d?: string | null) => (d ? fmtTime(d) : '');
const detail = (d: unknown) => (d && typeof d === 'object' && Object.keys(d).length ? JSON.stringify(d).slice(0, 300) : '');

/** Reads tasks (archived too), status history, activity, people and departments, then saves .xlsx or opens the PDF print view. */
export async function exportEverything(orgId: string, orgName: string, format: 'xlsx' | 'pdf') {
  const [tasks, history, activity, people, depts] = await Promise.all([
    fetchAll(() => supabase.from('tt_tasks').select('*, tt_task_assignees(user_id)').eq('org_id', orgId).order('created_at')),
    fetchAll(() => supabase.from('tt_task_status_history').select('*').eq('org_id', orgId).order('changed_at', { ascending: false })),
    fetchAll(() => supabase.from('tt_activity_logs').select('*').eq('org_id', orgId).order('created_at', { ascending: false })),
    loadPeople(orgId, true),
    supabase.from('tt_departments').select('id, name, created_at').eq('org_id', orgId).order('name').then((r) => r.data ?? []),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const who = (u?: string | null) => (u ? name.get(u) ?? 'Former member' : '');
  const dept = new Map(depts.map((d: any) => [d.id, d.name]));
  const title = new Map(tasks.map((t: any) => [t.id, t.title]));

  const T = ['Task', 'Status', 'Priority', 'Department', 'Assigned to', 'Lead', 'Manager', 'Start', 'Due', 'Created', 'Created by', 'Completed', 'Archived', 'Tags'];
  const tRows = tasks.map((t: any) => [t.title, label(t.status), label(t.priority ?? 'medium'), dept.get(t.department_id) ?? '', (t.tt_task_assignees ?? []).map((a: any) => who(a.user_id)).join(', '),
    who(t.lead_id), who(t.manager_id), when(t.start_date), when(t.due_date), when(t.created_at), who(t.created_by), when(t.completed_at), t.archived_at ? 'Yes' : '', (t.tags ?? []).join(', ')]);
  const H = ['When', 'Task', 'From', 'To', 'By', 'Comment'];
  const hRows = history.map((h: any) => [when(h.changed_at), title.get(h.task_id) ?? 'Deleted task', h.from_status ? label(h.from_status) : '', label(h.to_status), who(h.changed_by) || 'Taskify', h.reason ?? '']);
  const A = ['When', 'Who', 'Action', 'About', 'Details'];
  const aRows = activity.map((a: any) => [when(a.created_at), who(a.actor_id) || 'Taskify', label(a.action), a.entity_type === 'task' ? title.get(a.entity_id) ?? 'Task' : label(a.entity_type ?? ''), detail(a.detail)]);
  const P = ['Name', 'Email', 'Role', 'Active'];
  const pRows = people.map((p) => [p.name, p.email, label(p.role), p.active ? 'Yes' : 'No']);
  const D = ['Department', 'Created'];
  const dRows = depts.map((d: any) => [d.name, when(d.created_at)]);
  const file = fileStamp(`${orgName}_everything`);

  if (format === 'xlsx') {
    const sheet = (n: string, cols: string[], rows: Cell[][], widths: number[]) => ({ name: n, rows: [head(cols), ...rows], widths, freeze: 1 });
    saveBlob(`${file}.xlsx`, buildXlsx([
      sheet('Tasks', T, tRows, [40, 16, 10, 18, 28, 18, 18, 18, 18, 18, 18, 18, 9, 20]),
      sheet('Status history', H, hRows, [20, 40, 18, 18, 22, 40]),
      sheet('Activity', A, aRows, [20, 22, 24, 36, 60]),
      sheet('People', P, pRows, [26, 32, 12, 8]),
      sheet('Departments', D, dRows, [30, 20]),
    ]));
    return;
  }
  const cut = (n: number) => (n > PDF_ROWS ? `The newest ${PDF_ROWS} of ${n} rows. The Excel export has all of them.` : undefined);
  printReport({
    title: `${orgName}: everything`, subtitle: `Exported ${fmtTime(new Date().toISOString())}`,
    kpis: [['Tasks', tasks.length], ['Status changes', history.length], ['Activity entries', activity.length], ['People', people.length]],
    sections: [
      { title: 'Tasks', columns: ['Task', 'Status', 'Priority', 'Department', 'Assigned to', 'Due', 'Completed'], rows: tRows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[8], r[11]]) },
      { title: 'Status history', columns: H, rows: hRows.slice(0, PDF_ROWS), note: cut(hRows.length) },
      { title: 'Activity', columns: A.slice(0, 4), rows: aRows.slice(0, PDF_ROWS).map((r) => r.slice(0, 4)), note: cut(aRows.length) },
      { title: 'People', columns: P, rows: pRows },
      { title: 'Departments', columns: D, rows: dRows },
    ],
  });
}
