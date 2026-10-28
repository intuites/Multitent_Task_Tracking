import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { usePeople } from '../lib/ui';

interface Hit { group: string; text: string; to: string }

// Every query runs through RLS, so results are limited to what the caller may read.
export default function Search() {
  const { membership } = useAuth();
  const orgId = membership!.org_id;
  const { people } = usePeople(orgId);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const box = useRef<HTMLInputElement>(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim().replace(/[,()%*]/g, ' ');
    if (term.length < 2) { setHits([]); return; }
    const h = setTimeout(async () => {
      const like = `%${term}%`;
      const [c, ct, p, t, e] = await Promise.all([
        supabase.from('clients').select('id, name').eq('org_id', orgId).ilike('name', like).limit(5),
        supabase.from('client_contacts').select('client_id, full_name').eq('org_id', orgId).ilike('full_name', like).limit(5),
        supabase.from('projects').select('id, name').eq('org_id', orgId).ilike('name', like).limit(5),
        supabase.from('tt_tasks').select('id, title').eq('org_id', orgId).ilike('title', like).limit(5),
        supabase.from('tt_escalations').select('id, reason').eq('org_id', orgId).ilike('reason', like).limit(5),
      ]);
      const lc = term.toLowerCase();
      setHits([
        ...(c.data ?? []).map((x) => ({ group: 'Client', text: x.name, to: `/clients/${x.id}` })),
        ...(ct.data ?? []).map((x) => ({ group: 'Contact', text: x.full_name, to: `/clients/${x.client_id}` })),
        ...(p.data ?? []).map((x) => ({ group: 'Project', text: x.name, to: `/projects/${x.id}` })),
        ...(t.data ?? []).map((x) => ({ group: 'Task', text: x.title, to: `/tasks/${x.id}` })),
        ...(e.data ?? []).map((x) => ({ group: 'Escalation', text: x.reason, to: '/escalations' })),
        ...people.filter((x) => x.name.toLowerCase().includes(lc) || x.email.toLowerCase().includes(lc)).slice(0, 5).map((x) => ({ group: 'Employee', text: x.name, to: '/employees' })),
      ]);
    }, 250);
    return () => clearTimeout(h);
  }, [q, orgId, people]);

  return (
    <div className="search">
      <SearchIcon size={17} className="search-ico" aria-hidden="true" />
      <input ref={box} type="search" placeholder="Search tasks, clients, projects" aria-label="Global search" aria-keyshortcuts="Control+K Meta+K" value={q}
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      <kbd aria-hidden="true">{mac ? '⌘' : 'Ctrl'} K</kbd>
      {q.trim().length >= 2 && (
        <div className="results">
          <p className="sr-only" role="status">{hits.length} results</p>
          {hits.length === 0 ? <p>No results.</p> : hits.map((h, i) => <Link key={i} to={h.to} onClick={() => setQ('')}><small>{h.group}</small> {h.text}</Link>)}
        </div>)}
    </div>
  );
}
