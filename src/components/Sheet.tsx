import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** A side window over the page (native modal dialog: focus stays inside, Esc closes), like New task.
 *  `size="sm"` for a short form; the wide one fits a form with a preview beside it. */
export default function Sheet({ title, onClose, children, size = 'lg', className = '' }: {
  title: ReactNode; onClose: () => void; children: ReactNode; size?: 'sm' | 'lg'; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} className={`nt-sheet sheet-${size} ${className}`} aria-label={typeof title === 'string' ? title : undefined}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="nt-sheet-head"><h3>{title}</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      {children}
    </dialog>
  );
}
