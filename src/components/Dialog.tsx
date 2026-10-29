import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

interface Opts { title?: string; message: string; confirmLabel?: string; input?: string; danger?: boolean }
interface Result { ok: boolean; value: string }
type Pending = Opts & { resolve: (r: Result) => void };

let show: ((o: Opts) => Promise<Result>) | null = null;

/** In-page replacement for confirm()/prompt(). Esc or Cancel resolves { ok: false }. Needs <DialogHost /> mounted once. */
export const ask = (o: Opts): Promise<Result> => (show ? show(o) : Promise.resolve({ ok: false, value: '' }));

export function DialogHost() {
  const [p, setP] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { show = (o) => new Promise((resolve) => setP({ ...o, resolve })); return () => { show = null; }; }, []);
  useEffect(() => { if (p && ref.current && !ref.current.open) ref.current.showModal(); }, [p]);
  const close = (r: Result) => { p?.resolve(r); ref.current?.close(); setP(null); };
  return (
    <dialog ref={ref} aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); close({ ok: false, value: '' }); }}>
      {p && (
        <form onSubmit={(e) => { e.preventDefault(); close({ ok: true, value: String(new FormData(e.currentTarget).get('v') ?? '') }); }}>
          <span className={p.danger ? 'dlg-ico danger' : 'dlg-ico'} aria-hidden="true">{p.danger ? <AlertTriangle size={22} /> : <HelpCircle size={22} />}</span>
          <h2 id="dlg-title">{p.title ?? 'Please confirm'}</h2>
          <p className="dlg-msg">{p.message}</p>
          {p.input && <label>{p.input}<input name="v" autoFocus /></label>}
          <div className="actions">
            {/* destructive dialogs focus Cancel so a stray Enter doesn't delete anything */}
            <button type="button" className="pill-btn ghost" autoFocus={p.danger && !p.input} onClick={() => close({ ok: false, value: '' })}>Cancel</button>
            <button type="submit" className={p.danger ? 'danger' : ''} autoFocus={!p.danger && !p.input}>{p.confirmLabel ?? 'Confirm'}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
