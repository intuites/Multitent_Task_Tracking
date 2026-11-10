import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from './Frame';
import { mentionedIds, mentionQuery, type Mentionable } from '../lib/mentions';

/** A comment box where typing @ lists `people` (the task's assignees) to mention. Sends `mentions` (JSON ids) with the form. */
export default function MentionInput({ people, name, label, placeholder }: { people: Mentionable[]; name: string; label: string; placeholder?: string }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [query, setQuery] = useState<{ at: number; q: string } | null>(null);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null), listId = useId();
  const matches = query ? people.filter((p) => p.name.toLowerCase().includes(query.q.toLowerCase())) : [];
  const open = !!query;

  function track(value: string, caret: number) {
    setText(value);
    const q = mentionQuery(value, caret);
    setQuery(q); setHi(0);
  }
  function choose(p: Mentionable) {
    const el = ref.current!, caret = el.selectionStart, ins = `@${p.name} `;
    const next = text.slice(0, query!.at) + ins + text.slice(caret);
    setText(next); setPicked((x) => [...x, p]); setQuery(null);
    const pos = query!.at + ins.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }
  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[hi]); }
  }

  return (
    <>
      <textarea ref={ref} name={name} aria-label={label} rows={2} required placeholder={placeholder} value={text}
        role="combobox" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls={listId}
        aria-activedescendant={open && matches.length ? `${listId}-${hi}` : undefined}
        onChange={(e) => track(e.target.value, e.target.selectionStart)} onKeyDown={keys}
        onClick={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)} onBlur={() => setQuery(null)} />
      <input type="hidden" name="mentions" value={JSON.stringify(mentionedIds(text, picked))} />
      {open && (matches.length ? (
        <ul id={listId} role="listbox" className="mention-list" aria-label="Assignees to mention">
          {matches.map((p, i) => (
            <li key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setHi(i)}>
              <Avatar name={p.name} url={p.avatar} className="avatar sm" />{p.name}
            </li>))}
        </ul>
      ) : <p id={listId} className="mention-list mention-none">{people.length ? 'No assignee matches that name.' : 'Only this task’s assignees can be mentioned, and it has none besides you.'}</p>)}
    </>
  );
}

/** Comment text with each mentioned person's "@Name" highlighted. */
export function withMentions(body: string, names: string[]): ReactNode {
  const list = names.filter((n) => n && n !== '…').sort((a, b) => b.length - a.length);
  if (!list.length) return body;
  const re = new RegExp(`(${list.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`, 'g');
  return body.split(re).map((part, i) => (i % 2 ? <span key={i} className="mention">{part}</span> : part));
}
