import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildXlsx, crc32, zip } from './xlsx';
import { platformWorkbook, reportPdf, reportWorkbook } from './reportWorkbook';
import { reportHtml } from './printReport';

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

  it('escapes a sheet name inside chart formulas', async () => {
    const text = new TextDecoder().decode(new Uint8Array(await buildXlsx([
      { name: 'AT&T <x', rows: [['a', 1], ['b', 2]], charts: [{ type: 'bar', title: 'T', cats: { col: 0, from: 0, to: 1 }, series: [{ name: 'n', vals: { col: 1, from: 0, to: 1 }, color: '1B5E3B' }], at: { col: 3, row: 0, w: 6, h: 10 } }] },
    ]).arrayBuffer()));
    expect(text).toContain("<c:f>'AT&amp;T &lt;x'!");
    expect(text).not.toContain("<c:f>'AT&T <x'");
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
    // PDF version: same data as a print page, user text escaped
    const html = reportHtml(reportPdf({ org: 'ABC Pvt Ltd', filters: 'All tasks', tasks, depts, people, label }));
    expect(html).toContain('Task report — ABC Pvt Ltd');
    expect(html).toContain('Ravi &lt;QA&gt; &amp; Co');
    expect(html).not.toContain('<QA>');
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT.replace('.xlsx', '.html'), html);
  });

  it('builds the platform workbook with one sheet per organization and safe, unique sheet names', async () => {
    const orgs = ['Apple Inc', 'ABC Pvt Ltd', 'Northwind: East/West', 'Apple Inc'].map((name, i) => ({ id: `o${i}`, name, created_at: day(-100 * (i + 1)) }));
    const members = orgs.flatMap((o, i) => [0, 1, 2].map((k) => ({ org_id: o.id, user_id: `u${i}${k}`, role: ['admin', 'employee', 'employee'][k], active: true })));
    const profiles = members.map((m) => ({ user_id: m.user_id, full_name: `Person ${m.user_id}`, email: `${m.user_id}@x.com` }));
    const depts = orgs.flatMap((o) => [{ id: `${o.id}d1`, org_id: o.id, name: 'Finance' }, { id: `${o.id}d2`, org_id: o.id, name: 'Sales' }]);
    const statuses = ['not_yet_started', 'started', 'pending', 'completed_cycle', 'completed'];
    const tasks = Array.from({ length: 120 }, (_, i) => {
      const o = orgs[i % 4];
      return { id: `t${i}`, org_id: o.id, title: `Task ${i}`, status: statuses[(i * 7) % 5], priority: ['low', 'medium', 'high', 'urgent'][i % 4],
        department_id: i % 5 ? `${o.id}d${(i % 2) + 1}` : null, due_date: day((i % 11) - 5), start_date: null, created_at: day(-(i * 3) % 330),
        completed_at: (i * 7) % 5 >= 3 ? day(-(i * 2) % 300) : null, tt_task_assignees: [{ user_id: `u${i % 4}${i % 3}` }] };
    });
    const bytes = new Uint8Array(await platformWorkbook({ orgs, members, profiles, depts, tasks, label }).arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('name="Overview"');
    expect(text).toContain('name="Apple Inc (2)"');
    expect(text).toContain('name="Northwind  East West"');
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT.replace('.xlsx', '-platform.xlsx'), bytes);
  });
});
