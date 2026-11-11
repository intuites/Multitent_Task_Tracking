import { useEffect, useRef, useState } from 'react';
import { BarChart3, Building2, Download, FileSpreadsheet, FileText, Layers, ListChecks, Users } from 'lucide-react';
import type { Part } from '../lib/reportWorkbook';

export interface ExportChoice { parts: Part[]; format: 'xlsx' | 'pdf'; orgIds: string[] }
const PARTS: { id: Part; name: string; hint: string; icon: typeof Users }[] = [
  { id: 'summary', name: 'Summary with charts', hint: 'Totals, status, priority, monthly trend', icon: BarChart3 },
  { id: 'people', name: 'People performance', hint: 'Open, completed, overdue per person', icon: Users },
  { id: 'depts', name: 'Departments', hint: 'Task counts per department', icon: Layers },
  { id: 'tasks', name: 'Full task list', hint: 'Every task, with description, creator, subtasks', icon: ListChecks },
];

/** Reports → Export: pick what goes in the file and its format. orgs (platform admins only) adds a pick of organizations. */
export default function ReportExport({ open, onClose, onExport, orgs, current, note }: {
  open: boolean; onClose: () => void; onExport: (c: ExportChoice) => Promise<void>;
  orgs?: { id: string; name: string }[]; current: string; note: string;
}) {
  const ref = useRef<HTMLDialogElement>(null), allRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState<Part[]>(PARTS.map((p) => p.id));
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  const [ids, setIds] = useState<string[]>([current]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const d = ref.current; if (open && d && !d.open) { setError(''); d.showModal(); } if (!open && d?.open) d.close(); }, [open]);
  const all = !!orgs && ids.length === orgs.length;
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = !all && ids.length > 0; }, [all, ids]);
  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const n = orgs ? ids.length : 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onExport({ parts, format, orgIds: orgs ? ids : [current] }); onClose(); }
    catch (x) { setError((x as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <dialog ref={ref} className="dlg-pick xp" aria-labelledby="xp-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      {open && (
        <form onSubmit={submit}>
          <span className="dlg-ico" aria-hidden="true"><Download size={22} /></span>
          <h2 id="xp-title">Export report</h2>
          <p className="dlg-msg">{note}</p>

          {orgs && (
            <fieldset className="xp-set">
              <legend>Organizations <small>{ids.length} of {orgs.length}</small></legend>
              <label className="xp-row xp-all"><input ref={allRef} type="checkbox" checked={all} onChange={() => setIds(all ? [] : orgs.map((o) => o.id))} />
                <Building2 size={16} aria-hidden="true" /><b>All organizations</b></label>
              <div className="xp-orgs">
                {orgs.map((o) => (
                  <label key={o.id} className="xp-row"><input type="checkbox" checked={ids.includes(o.id)} onChange={() => setIds((x) => flip(x, o.id))} />
                    <span>{o.name}</span>{o.id === current && <small>Open now</small>}</label>))}
              </div>
            </fieldset>)}

          <fieldset className="xp-set">
            <legend>Include</legend>
            <div className="xp-parts">
              {PARTS.map((p) => (
                <label key={p.id} className="dlg-choice xp-part">
                  <span className="dlg-choice-ico" aria-hidden="true"><p.icon size={17} /></span>
                  <span className="dlg-choice-text"><b>{p.name}</b><small>{p.hint}</small></span>
                  <input type="checkbox" checked={parts.includes(p.id)} onChange={() => setParts((x) => flip(x, p.id))} />
                </label>))}
            </div>
          </fieldset>

          <fieldset className="xp-set">
            <legend>Format</legend>
            <div className="xp-fmt">
              {([['xlsx', 'Excel', 'Sheets with charts', FileSpreadsheet], ['pdf', 'PDF', 'Ready to print or share', FileText]] as const).map(([v, name, hint, Icon]) => (
                <label key={v} className="dlg-choice">
                  <span className="dlg-choice-ico" aria-hidden="true"><Icon size={17} /></span>
                  <span className="dlg-choice-text"><b>{name}</b><small>{hint}</small></span>
                  <input type="radio" name="xp-format" checked={format === v} onChange={() => setFormat(v)} />
                </label>))}
            </div>
          </fieldset>

          {error && <p role="alert" className="form-alert">{error}</p>}
          <div className="actions">
            <button type="button" className="pill-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || !parts.length || !n}>
              {busy ? 'Preparing…' : !n ? 'Pick an organization' : !parts.length ? 'Pick what to include' : n > 1 ? `Export ${n} organizations` : 'Export'}
            </button>
          </div>
        </form>)}
    </dialog>
  );
}
