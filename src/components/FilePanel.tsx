import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { supabase } from '../lib/supabase';
import { fmtTime } from '../lib/ui';
import { ask } from './Dialog';

const MAX = 10 * 1024 * 1024;
const OK = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'application/zip', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

interface Props {
  orgId: string; userId: string; entityType: 'task' | 'project' | 'client'; entityId: string;
  canUpload: boolean; canDelete: boolean; portal?: boolean; // portal uploads are always client-visible
}

export default function FilePanel({ orgId, userId, entityType, entityId, canUpload, canDelete, portal }: Props) {
  const [files, setFiles] = useState<any[]>([]);
  const [shared, setShared] = useState(!!portal);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('tt_files').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false });
    setFiles(data ?? []);
  }, [entityType, entityId]);
  useEffect(() => { load(); }, [load]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX) return setError('File is larger than 10 MB.');
    if (!OK.includes(file.type)) return setError('This file type is not allowed.');
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-100);
    const path = `${orgId}/${entityType}/${entityId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from('tt-files').upload(path, file, { contentType: file.type });
    if (up.error) return setError(up.error.message);
    const { error } = await supabase.from('tt_files').insert({
      org_id: orgId, entity_type: entityType, entity_id: entityId, path, name: file.name, mime: file.type, size_bytes: file.size,
      visibility: portal || shared ? 'client' : 'internal', uploaded_by: userId,
    });
    if (error) { await supabase.storage.from('tt-files').remove([path]); return setError(error.message); }
    setError(''); load();
  }
  async function open(f: any) {
    const { data, error } = await supabase.storage.from('tt-files').createSignedUrl(f.path, 60); // short-lived
    if (error || !data) return setError('Could not open file.');
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  async function remove(f: any) {
    if (!(await ask({ message: `Delete ${f.name}?`, confirmLabel: 'Delete', danger: true })).ok) return;
    await supabase.storage.from('tt-files').remove([f.path]);
    await supabase.from('tt_files').delete().eq('id', f.id);
    load();
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {files.length === 0 ? <p>No files.</p> : (
        <ul className="plain">{files.map((f) => (
          <li key={f.id}>
            <button className="link" onClick={() => open(f)}>{f.name}</button>{' '}
            <small>{f.visibility === 'client' ? 'shared with client' : 'internal'} · {Math.ceil((f.size_bytes ?? 0) / 1024)} KB · {fmtTime(f.created_at)}</small>
            {canDelete && <button className="link" onClick={() => remove(f)}>Delete</button>}
          </li>))}
        </ul>
      )}
      {canUpload && (
        <div className="row filters">
          <input type="file" onChange={upload} aria-label="Upload file" />
          {!portal && <label className="inline"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with client</label>}
        </div>
      )}
    </div>
  );
}
