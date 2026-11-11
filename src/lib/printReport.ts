// Print-ready report: a styled HTML page (KPI tiles, bar charts, tables) handed to the browser's print dialog,
// where "Save as PDF" produces the file. No PDF library needed; colours are forced on so charts print.

export interface PdfSection {
  title: string;
  /** horizontal bar chart above the table */
  bars?: { label: string; value: number; color?: string; suffix?: string }[];
  /** stacked segments per row, e.g. completed / open / overdue */
  stacked?: { label: string; parts: { value: number; color: string; name: string }[] }[];
  columns?: string[];
  rows?: (string | number)[][];
  note?: string;
}
export interface PdfReport { title: string; subtitle: string; kpis: [string, string | number][]; sections: PdfSection[] }

// the open organization's brand color (set by lib/theme.ts applyBrand), default green when none or outside a browser
const brandColor = () => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()).match(/^#[0-9a-f]{6}$/i)?.[0] ?? '#2e7d4f';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bars(list: NonNullable<PdfSection['bars']>) {
  const max = Math.max(1, ...list.map((b) => b.value));
  return `<div class="bars">${list.map((b) => `<div class="bar"><span class="bl">${esc(b.label)}</span><span class="bt"><i style="width:${Math.max(b.value ? 2 : 0, (b.value / max) * 100)}%;background:${b.color ? '#' + b.color : 'var(--a)'}"></i></span><b>${esc(b.value)}${esc(b.suffix ?? '')}</b></div>`).join('')}</div>`;
}
function stacked(list: NonNullable<PdfSection['stacked']>) {
  const max = Math.max(1, ...list.map((r) => r.parts.reduce((n, p) => n + p.value, 0)));
  const legend = list[0] ? `<div class="legend">${list[0].parts.map((p) => `<span><i style="background:#${p.color}"></i>${esc(p.name)}</span>`).join('')}</div>` : '';
  return `<div class="bars">${list.map((r) => {
    const total = r.parts.reduce((n, p) => n + p.value, 0);
    return `<div class="bar"><span class="bl">${esc(r.label)}</span><span class="bt stack" style="width:${(total / max) * 100}%">${r.parts.filter((p) => p.value)
      .map((p) => `<i style="flex:${p.value};background:#${p.color}" title="${esc(p.name)}"></i>`).join('')}</span><b>${total}</b></div>`;
  }).join('')}</div>${legend}`;
}

// a column whose every value is a number (or a percentage) is right-aligned; short values never wrap
const isNum = (v: unknown) => typeof v === 'number' || /^-?\d+(\.\d+)?%?$/.test(String(v));
function table(s: PdfSection) {
  const rows = s.rows!, num = s.columns!.map((_, i) => rows.every((r) => isNum(r[i]) || r[i] === '' || r[i] === '—'));
  // numbers and dates ("Nov 04, 2026") stay on one line
  const cls = (i: number, v: unknown) => (num[i] ? 'n' : /^[A-Z][a-z]{2} \d{2}, \d{4}$/.test(String(v)) ? 's' : '');
  // the long text columns get the room; the rest size to their content
  const width: Record<string, string> = { Task: '19%', Description: '25%', 'Assigned to': '12%' };
  // a short table moves to the next page whole rather than leaving a row or two behind
  return `<table${rows.length <= 15 ? ' class="keep"' : ''}><thead><tr>${s.columns!.map((c, i) => `<th${num[i] ? ' class="n"' : ''}${width[c] && (s.columns!.length > 8) ? ` style="width:${width[c]}"` : ''}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((c, i) => `<td class="${cls(i, c)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
// text inside a CSS string (the page footer): no quotes, backslashes or line breaks
const cssText = (v: string) => v.replace(/["\\\n\r]/g, ' ');

export function reportHtml(r: PdfReport) {
  // a table with many columns (the full task list) prints landscape so it isn't shrunk to fit
  const wide = r.sections.some((s) => (s.columns?.length ?? 0) > 8);
  const sections = r.sections.map((s) => `<section${(s.columns?.length ?? 0) > 8 ? ' class="wide"' : ''}><h2>${esc(s.title)}</h2>${s.bars?.length ? bars(s.bars) : ''}${s.stacked?.length ? stacked(s.stacked) : ''}
    ${s.columns && s.rows?.length ? table(s) : ''}
    ${s.rows && !s.rows.length ? '<p class="empty">Nothing to show.</p>' : ''}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
  :root { --a: ${brandColor()}; --b: color-mix(in oklab, var(--a) 72%, #000); --ink: #1f2a24; --mute: #5b6862; --line: #dfe6e2; }
  /* our own page footer; declaring margin boxes also stops the browser printing its date, title and URL on every page */
  @page { size: A4${wide ? ' landscape' : ''}; margin: 13mm 12mm 15mm;
    @top-left { content: ''; } @top-center { content: ''; } @top-right { content: ''; } @bottom-center { content: ''; }
    @bottom-left { content: "Taskify  |  ${cssText(r.title)}"; font: 9pt "Segoe UI", system-ui, sans-serif; color: #7b8781; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt "Segoe UI", system-ui, sans-serif; color: #7b8781; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 10.5pt/1.45 "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--ink); }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 0 0 10pt; border-bottom: 3px solid var(--b); margin-bottom: 14pt; }
  header h1 { margin: 0; font-size: 20pt; line-height: 1.2; color: var(--b); } header p { margin: 4pt 0 0; color: var(--mute); font-size: 10pt; }
  .mark { flex: none; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, color-mix(in oklab, var(--a) 90%, #000), color-mix(in oklab, var(--a) 55%, #000)); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 17px; }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8pt; margin-bottom: 16pt; break-inside: avoid; }
  .kpi { padding: 9pt 11pt; border-radius: 9px; background: color-mix(in oklab, var(--a) 11%, #fff); }
  .kpi small { display: block; color: var(--mute); font-size: 9.5pt; } .kpi b { display: block; margin-top: 2pt; font-size: 18pt; line-height: 1.15; color: var(--b); }
  /* long sections flow onto the next page; a heading never sits alone at the bottom, a chart never splits */
  section { margin: 0 0 16pt; } h2 { font-size: 13pt; color: var(--b); margin: 0 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid var(--line); break-after: avoid; }
  .bars { display: grid; gap: 5pt; margin: 4pt 0 10pt; break-inside: avoid; }
  .bar { display: grid; grid-template-columns: minmax(130px, 24%) minmax(0, 1fr) 48px; gap: 10px; align-items: center; font-size: 10pt; }
  .bl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bar b { text-align: right; font-variant-numeric: tabular-nums; }
  .bt { height: 11pt; border-radius: 6px; background: #eef2ef; overflow: hidden; display: block; } .bt i { display: block; height: 100%; border-radius: 6px; }
  .bt.stack { display: flex; background: none; } .bt.stack i { border-radius: 0; } .bt.stack i:first-child { border-radius: 6px 0 0 6px; } .bt.stack i:last-child { border-radius: 0 6px 6px 0; }
  .legend { display: flex; gap: 16px; color: var(--mute); font-size: 9.5pt; margin: 0 0 8pt; } .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; } thead { display: table-header-group; } tr { break-inside: avoid; }
  th { background: var(--b); color: #fff; text-align: left; font-weight: 600; padding: 6pt 7pt; vertical-align: bottom; }
  td { padding: 5pt 7pt; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: break-word; } tr:nth-child(even) td { background: #f5f8f6; }
  table.keep { break-inside: avoid; } .n { text-align: right; font-variant-numeric: tabular-nums; } td.s { white-space: nowrap; }
  .wide table { font-size: 9pt; } .wide th, .wide td { padding-left: 5pt; padding-right: 5pt; }  .note, .empty { color: var(--mute); font-style: italic; margin: 6pt 0 0; }
  </style></head><body>
  <header><div><h1>${esc(r.title)}</h1><p>${esc(r.subtitle)}</p></div><span class="mark">T</span></header>
  ${r.kpis.length ? `<div class="kpis">${r.kpis.map(([k, v]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
  ${sections}</body></html>`;
}

/** Opens the print dialog for the report; choose "Save as PDF" as the destination. */
export function printReport(r: PdfReport) {
  // a hidden iframe avoids popup blockers and leaves the app page untouched
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(reportHtml(r)); doc.close();
  const go = () => { frame.contentWindow!.focus(); frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60000); };
  if (doc.readyState === 'complete') setTimeout(go, 50); else frame.onload = go;
}
