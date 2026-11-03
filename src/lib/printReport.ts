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

export function reportHtml(r: PdfReport) {
  const sections = r.sections.map((s) => `<section><h2>${esc(s.title)}</h2>${s.bars?.length ? bars(s.bars) : ''}${s.stacked?.length ? stacked(s.stacked) : ''}
    ${s.columns && s.rows?.length ? `<table><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
    ${s.rows && !s.rows.length ? '<p class="empty">Nothing to show.</p>' : ''}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
  :root { --a: ${brandColor()}; --b: color-mix(in oklab, var(--a) 72%, #000); }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 11px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif; color: #1f2a24; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding: 0 0 12px; border-bottom: 3px solid var(--b); margin-bottom: 16px; }
  header h1 { margin: 0; font-size: 22px; color: var(--b); } header p { margin: 4px 0 0; color: #6b7770; }
  .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, color-mix(in oklab, var(--a) 90%, #000), color-mix(in oklab, var(--a) 55%, #000)); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 17px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
  .kpi { padding: 10px 12px; border-radius: 10px; background: color-mix(in oklab, var(--a) 11%, #fff); } .kpi small { display: block; color: #4d5a53; } .kpi b { font-size: 19px; color: var(--b); }
  section { margin: 0 0 18px; break-inside: avoid-page; } h2 { font-size: 13px; color: var(--b); margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d5ddd8; }
  .bars { display: grid; gap: 5px; margin: 6px 0 10px; } .bar { display: grid; grid-template-columns: 150px 1fr 48px; gap: 8px; align-items: center; }
  .bl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bar b { text-align: right; }
  .bt { height: 12px; border-radius: 6px; background: #eef2ef; overflow: hidden; display: block; } .bt i { display: block; height: 100%; border-radius: 6px; }
  .bt.stack { display: flex; background: none; } .bt.stack i { border-radius: 0; } .bt.stack i:first-child { border-radius: 6px 0 0 6px; } .bt.stack i:last-child { border-radius: 0 6px 6px 0; }
  .legend { display: flex; gap: 14px; color: #4d5a53; margin-bottom: 8px; } .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; } th { background: var(--b); color: #fff; text-align: left; font-weight: 600; padding: 5px 7px; }
  td { padding: 4px 7px; border-bottom: 1px solid #e4e9e6; } tr:nth-child(even) td { background: #f5f8f6; } thead { display: table-header-group; } tr { break-inside: avoid; }
  .note, .empty { color: #6b7770; font-style: italic; margin: 6px 0 0; }
  footer { margin-top: 20px; color: #9aa5a0; font-size: 10px; text-align: center; }
  </style></head><body>
  <header><div><h1>${esc(r.title)}</h1><p>${esc(r.subtitle)}</p></div><span class="mark">T</span></header>
  <div class="kpis">${r.kpis.map(([k, v]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
  ${sections}<footer>Taskify · ${esc(new Date().toLocaleString())}</footer></body></html>`;
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
