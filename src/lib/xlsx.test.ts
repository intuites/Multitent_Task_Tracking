import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { crc32, zip } from './xlsx';
import { reportWorkbook } from './reportWorkbook';

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();

describe('xlsx writer', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('zip has a valid end record listing every file', () => {
    const z = zip([['a.txt', 'hello'], ['b/c.xml', '<x/>']]);
    const end = new DataView(z.buffer, z.length - 22);
    expect(end.getUint32(0, true)).toBe(0x06054b50);
    expect(end.getUint16(10, true)).toBe(2);
  });

  it('builds a report workbook with sheets, charts and escaped text', async () => {
    const people = [{ id: 'u1', name: 'Priya', email: 'p@x.com', role: 'admin' }, { id: 'u2', name: 'Ravi <QA> & Co', email: 'r@x.com', role: 'employee' }];
    const depts = [{ id: 'd1', name: 'Finance' }, { id: 'd2', name: 'Operations' }];
    const statuses = ['not_yet_started', 'started', 'pending', 'completed_cycle', 'completed'];
    const tasks = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, title: i === 0 ? '=HYPERLINK("http://evil")' : `Task ${i}`, status: statuses[i % 5], priority: ['low', 'medium', 'high', 'urgent'][i % 4],
      department_id: i % 3 === 0 ? null : depts[i % 2].id, due_date: day((i % 9) - 4), start_date: null, created_at: day(-i * 7),
      completed_at: i % 5 >= 3 ? day(-i * 3) : null, tt_task_assignees: [{ user_id: people[i % 2].id }],
    }));
    const blob = reportWorkbook({ org: 'ABC Pvt Ltd', filters: 'All tasks', tasks, depts, people, label });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    for (const part of ['xl/workbook.xml', 'xl/worksheets/sheet4.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml']) expect(text).toContain(part);
    expect(text).toContain('Ravi &lt;QA&gt; &amp; Co');
    // user text is stored as an inline string, never as a formula
    expect(text).not.toContain('<f>');
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, bytes);
  });
});
