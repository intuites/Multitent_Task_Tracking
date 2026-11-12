import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Search, Trash2 } from 'lucide-react';
import Sheet from './Sheet';
import TabThumb from './TabThumb';
import { ask } from './Dialog';
import { supabase } from '../lib/supabase';
import { label, rpc } from '../lib/ui';
import { TASK_STATUSES } from '../../api/_lib/taskStatus';
import { Count } from '../stageshow/kit/motion';
import './deleteData.css';

type Kind = 'tasks' | 'activity' | 'notifications' | 'emails' | 'templates' | 'departments';
const KINDS: { id: Kind; name: string; note: string }[] = [
  { id: 'tasks', name: 'Tasks', note: 'Deleting a task also deletes its subtasks, comments, assignees, history and files.' },
  { id: 'activity', name: 'Activity logs', note: 'Entries in the Activity log. One line recording the deletion stays.' },
  { id: 'notifications', name: 'Notifications', note: "Everyone's in-app notifications in this organization." },
  { id: 'emails', name: 'Email log', note: 'The record of emails sent or queued. Already-sent emails stay in inboxes.' },
  { id: 'templates', name: 'Templates', note: 'Task templates. Tasks already created from them stay.' },
  { id: 'departments', name: 'Departments', note: 'Departments and their member lists. People stay in the organization; their tasks lose the department.' },
];
interface Row { id: string; title: string; sub: string; at: string }
const LIMIT = 200;

/** Platform admins: delete rows of one organization's data, picked by kind, filters and ticks. Never tables, the organization or its people. */
export default function DeleteData({ orgs, start, onClose }: { orgs: { id: string; name: string }[]; start?: string; onClose: () => void }) {
  const [org, setOrg] = useState(start && orgs.some((o) => o.id === start) ? start : orgs[0]?.id ?? '');
  const [kind, setKind] = useState<Kind>('tasks');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [q, setQ] = useState(''), [status, setStatus] = useState('');
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const orgName = orgs.find((o) => o.id === org)?.name ?? 'this organization';
  const filtered = !!(from || to || q.trim() || (kind === 'tasks' && status));
  const missing = (m: string) => (/tt_platform_data|schema cache|function/i.test(m) ? 'This needs the database update: run supabase/migrations/0051_platform_data_delete.sql, then try again.' : m);

  const args = (limit: number) => ({
    p_org: org, p_kind: kind, p_from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
    // "To" includes that whole day
    p_to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 864e5).toISOString() : null,
    p_q: q.trim() || null, p_status: kind === 'tasks' && status ? status : null, p_limit: limit,
  });
  const load = useCallback(async () => {
    if (!org) return;
    setData(null); setPicked([]);
    try { setData(await rpc<{ total: number; rows: Row[] }>('tt_platform_data_list', args(LIMIT))); }
    catch (x) { setMsg({ kind: 'error', text: missing((x as Error).message) }); setData({ total: 0, rows: [] }); }
  }, [org, kind, from, to, q, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const run = async (ids: string[] | null, what: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await rpc<{ deleted: number; files: string[] }>('tt_platform_delete', { p_org: org, p_kind: kind, p_ids: ids });
      if (r.files?.length) await supabase.storage.from('tt-files').remove(r.files); // best effort: a leftover file is harmless
      setMsg({ kind: 'ok', text: `Deleted ${r.deleted} ${what} from ${orgName}.` });
      await load();
    } catch (x) { setMsg({ kind: 'error', text: missing((x as Error).message) }); }
    setBusy(false);
  };
  const k = KINDS.find((x) => x.id === kind)!;
  const deletePicked = async () => {
    const n = picked.length;
    if (!(await ask({ title: `Delete ${n} ${k.name.toLowerCase()}?`, message: `${k.note} This can't be undone.`, confirmLabel: `Delete ${n}`, danger: true })).ok) return;
    run(picked, k.name.toLowerCase());
  };
  const confirmName = async (title: string, message: string) => {
    const r = await ask({ title, message: `${message} This can't be undone. Type the organization's name, ${orgName}, to confirm.`, input: 'Organization name', confirmLabel: 'Delete', danger: true });
    if (!r.ok) return false;
    if (r.value.trim() !== orgName.trim()) { setMsg({ kind: 'error', text: "The name didn't match, so nothing was deleted." }); return false; }
    return true;
  };
  const deleteMatching = async () => {
    const total = data?.total ?? 0;
    if (!(await confirmName(`Delete all ${total} matching ${k.name.toLowerCase()}?`, k.note))) return;
    if (!filtered) return run(null, k.name.toLowerCase());
    // filtered: delete exactly the matching rows (up to 1,000 at a time)
    try {
      const all = await rpc<{ total: number; rows: Row[] }>('tt_platform_data_list', args(1000));
      await run(all.rows.map((r) => r.id), k.name.toLowerCase());
      if (all.total > all.rows.length) setMsg({ kind: 'ok', text: `Deleted the first ${all.rows.length}. ${all.total - all.rows.length} more match: press Delete all matching again.` });
    } catch (x) { setMsg({ kind: 'error', text: missing((x as Error).message) }); }
  };
  const clearAll = async () => {
    if (!(await confirmName(`Delete all data in ${orgName}?`, 'Every task, activity log entry, notification, email log entry, template and department in this organization. The organization and its people stay.'))) return;
    setBusy(true); setMsg(null);
    let total = 0;
    try {
      for (const kd of KINDS.map((x) => x.id)) {
        const r = await rpc<{ deleted: number; files: string[] }>('tt_platform_delete', { p_org: org, p_kind: kd, p_ids: null });
        if (r.files?.length) await supabase.storage.from('tt-files').remove(r.files);
        total += r.deleted;
      }
      setMsg({ kind: 'ok', text: `Deleted ${total} rows from ${orgName}. The organization and its people stay.` });
    } catch (x) { setMsg({ kind: 'error', text: missing((x as Error).message) }); }
    setBusy(false); load();
  };

  const rows = data?.rows ?? [];
  const allOn = rows.length > 0 && rows.every((r) => picked.includes(r.id));
  const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Sheet title="Delete data" onClose={onClose} className="dd-sheet">
      <div className="dd">
        <p className="dd-intro"><AlertTriangle size={16} aria-hidden="true" />Deletes rows only, never tables. The organization, its members and their profiles always stay.</p>
        <label className="dd-org">Organization<select value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>

        <div className="seg dd-kinds" role="group" aria-label="What to delete">
          <TabThumb />
          {KINDS.map((x) => <button key={x.id} type="button" aria-pressed={kind === x.id} onClick={() => { setKind(x.id); setStatus(''); }}>{x.name}</button>)}
        </div>
        <p className="muted dd-note">{k.note}</p>

        <div className="dd-filters">
          <label className="dd-search"><Search size={15} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" /></label>
          {kind !== 'templates' && kind !== 'departments' && <>
            <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          </>}
          {kind === 'tasks' && <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>}
        </div>

        <div className="dd-list" aria-busy={!data}>
          <div className="dd-head">
            <label className="dd-all"><input type="checkbox" checked={allOn} disabled={!rows.length} onChange={() => setPicked(allOn ? [] : rows.map((r) => r.id))} aria-label="Select all in the list" />
              <span><b><Count value={data?.total ?? 0} /></b> matching{data && data.total > rows.length ? `, first ${rows.length} shown` : ''}</span></label>
            {picked.length > 0 && <span className="dd-picked">{picked.length} selected</span>}
          </div>
          {!data ? <p className="muted dd-empty">Loading…</p> : rows.length === 0 ? <p className="muted dd-empty">Nothing matches.</p> : (
            <ul>{rows.map((r) => (
              <li key={r.id}><label>
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                <span className="dd-text"><b title={r.title}>{r.title}</b>{r.sub && <small>{r.sub}</small>}</span>
                <time>{day(r.at)}</time>
              </label></li>))}</ul>)}
        </div>

        {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`dd-msg ${msg.kind}`}>{msg.text}</p>}

        <details className="dd-danger">
          <summary>Delete everything in {orgName}</summary>
          <p className="muted">Every task, activity log entry, notification, email log entry, template and department. The organization and its people stay.</p>
          <button type="button" className="pill-btn ghost danger-text" disabled={busy} onClick={clearAll}><Trash2 size={15} aria-hidden="true" />Delete all data</button>
        </details>
      </div>
      <div className="nt-actions dd-actions">
        <button type="button" className="danger" disabled={busy || !picked.length} onClick={deletePicked}><Trash2 size={15} aria-hidden="true" />Delete selected ({picked.length})</button>
        <button type="button" className="pill-btn ghost danger-text" disabled={busy || !data?.total} onClick={deleteMatching}>Delete all {data?.total ?? 0} matching</button>
      </div>
    </Sheet>
  );
}
