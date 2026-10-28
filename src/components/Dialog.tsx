import { useEffect, useRef, useState } from 'react';

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
          <h2 id="dlg-title">{p.title ?? 'Please confirm'}</h2>
          <p>{p.message}</p>
          {p.input && <label>{p.input}<input name="v" autoFocus /></label>}
          <div className="actions">
            <button type="button" className="link" onClick={() => close({ ok: false, value: '' })}>Cancel</button>
            <button type="submit" className={p.danger ? 'danger' : ''}>{p.confirmLabel ?? 'Confirm'}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
