// Minimal .xlsx writer: styled cells, merged titles, frozen headers, filters and native Excel charts.
// An .xlsx is a zip of XML parts; this writes them directly so no spreadsheet library is needed.

export type Style = 'title' | 'sub' | 'section' | 'head' | 'text' | 'num' | 'pct' | 'date' | 'kpiLabel' | 'kpiNum' | 'kpiPct'
  | 'done' | 'started' | 'pending' | 'idle' | 'bad' | 'zText' | 'zNum' | 'zDate' | 'badText';
export type Value = string | number | Date | null | undefined;
export type Cell = Value | { v: Value; s: Style };
/** A run of cells in one column of the same sheet, 0-based, inclusive. */
export interface Span { col: number; from: number; to: number }
export interface Chart {
  type: 'col' | 'bar' | 'pie' | 'doughnut' | 'line'; title: string; cats: Span;
  series: { name: string; vals: Span; color: string }[];
  /** pie/doughnut: one colour per category, in order (defaults to the palette) */
  colors?: string[];
  /** top-left cell (0-based) and size in columns/rows */
  at: { col: number; row: number; w: number; h: number };
}
export interface Sheet { name: string; rows: Cell[][]; widths?: number[]; charts?: Chart[]; freeze?: number; filter?: { row: number; cols: number; last: number }; merges?: string[]; tall?: number[] }

// order matters: the index is the style id written into each cell
const STYLES: Style[] = ['text', 'title', 'sub', 'section', 'head', 'num', 'pct', 'date', 'kpiLabel', 'kpiNum', 'kpiPct',
  'done', 'started', 'pending', 'idle', 'bad', 'zText', 'zNum', 'zDate', 'badText'];
const PALETTE = ['1B5E3B', '3F9D6B', '7CC49C', 'F2B134', '4A90D9', 'E06C5A', '8E7CC3', '9AA5A0'];
export const COLORS = { brand: '1B5E3B', green: '3F9D6B', mint: '7CC49C', amber: 'F2B134', blue: '4A90D9', red: 'E06C5A', grey: '9AA5A0' };

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = (c: number): string => (c >= 26 ? colName(Math.floor(c / 26) - 1) : '') + String.fromCharCode(65 + (c % 26));
const ref = (c: number, r: number, abs = false) => (abs ? `$${colName(c)}$${r + 1}` : `${colName(c)}${r + 1}`);
const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;
// Excel serial date in local time
const serial = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 864e5 + 25569;
const unwrap = (c: Cell): { v: Value; s?: Style } => (c !== null && typeof c === 'object' && !(c instanceof Date) ? c : { v: c });

function cellXml(c: Cell, col: number, row: number) {
  const { v, s } = unwrap(c);
  const style = s ?? (v instanceof Date ? 'date' : typeof v === 'number' ? 'num' : 'text');
  const at = `r="${ref(col, row)}" s="${STYLES.indexOf(style)}"`;
  if (v === null || v === undefined || v === '') return s ? `<c ${at}/>` : '';
  if (v instanceof Date) return `<c ${at}><v>${serial(v)}</v></c>`;
  if (typeof v === 'number') return Number.isFinite(v) ? `<c ${at}><v>${v}</v></c>` : `<c ${at}/>`;
  // inline strings are never evaluated as formulas, so user text is safe here
  return `<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sh: Sheet, hasDrawing: boolean) {
  const freeze = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sh.rows.map((r, i) => {
    const ht = sh.tall?.includes(i) ? ' ht="30" customHeight="1"' : '';
    return `<row r="${i + 1}"${ht}>${r.map((c, j) => cellXml(c, j, i)).join('')}</row>`;
  }).join('');
  const f = sh.filter ? `<autoFilter ref="${ref(0, sh.filter.row)}:${ref(sh.filter.cols - 1, sh.filter.last)}"/>` : '';
  const m = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18" customHeight="1"/>${cols}`
    + `<sheetData>${rows}</sheetData>${f}${m}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
    + `${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="0%"/></numFmts>
<fonts count="12">
<font><sz val="11"/><color rgb="FF1F2A24"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="20"/><color rgb="FF1B5E3B"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7770"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="13"/><color rgb="FF1B5E3B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2A24"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF1B5E3B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1B5E3B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1D4E89"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF8A5A00"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF55626A"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFA12A2A"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="10">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B5E3B"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F3EC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD7F0E0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDF0D5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECEFF1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBE0E0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF5F8F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5DDD8"/></left><right style="thin"><color rgb="FFD5DDD8"/></right><top style="thin"><color rgb="FFD5DDD8"/></top><bottom style="thin"><color rgb="FFD5DDD8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="bottom"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="6" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="6" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="9" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="10" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="11" fillId="8" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="9" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="9" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="11" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const fill = (hex: string) => `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>`;
const labels = (pct: boolean, ink = '333F38') => `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="${ink}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
  + `<c:showLegendKey val="0"/><c:showVal val="${pct ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pct ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`;

function chartXml(ch: Chart, sh: Sheet) {
  const read = (s: Span) => sh.rows.slice(s.from, s.to + 1).map((r) => unwrap(r[s.col] ?? null).v);
  const rng = (s: Span) => `${esc(quote(sh.name))}!${ref(s.col, s.from, true)}:${ref(s.col, s.to, true)}`;
  const n = ch.cats.to - ch.cats.from + 1;
  const cat = `<c:cat><c:strRef><c:f>${rng(ch.cats)}</c:f><c:strCache><c:ptCount val="${n}"/>${read(ch.cats).map((v, i) => `<c:pt idx="${i}"><c:v>${esc(String(v ?? ''))}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
  const val = (s: Span) => `<c:val><c:numRef><c:f>${rng(s)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${read(s).map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>`;
  const round = ch.type === 'pie' || ch.type === 'doughnut';
  const ser = ch.series.map((s, i) => {
    const head = `<c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
    if (round) {
      const pts = Array.from({ length: n }, (_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${ch.colors?.[k] ?? PALETTE[k % PALETTE.length]}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('');
      return `<c:ser>${head}${pts}${labels(true, 'FFFFFF')}${cat}${val(s.vals)}</c:ser>`;
    }
    if (ch.type === 'line') return `<c:ser>${head}<c:spPr><a:ln w="31750" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:round/></a:ln></c:spPr>`
      + `<c:marker><c:symbol val="circle"/><c:size val="7"/>${fill(s.color)}</c:marker>${ch.series.length <= 2 ? labels(false) : ''}${cat}${val(s.vals)}<c:smooth val="0"/></c:ser>`;
    return `<c:ser>${head}${fill(s.color)}<c:invertIfNegative val="0"/>${labels(false)}${cat}${val(s.vals)}</c:ser>`;
  }).join('');
  const axes = `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${ch.type === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.type === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:spPr><a:ln><a:solidFill><a:srgbClr val="D5DDD8"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="55626A"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
    + `<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.type === 'bar' ? 'b' : 'l'}"/>`
    + `<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="EEF2EF"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="55626A"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
    + `<c:crossAx val="5001"/><c:crosses val="${ch.type === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  const plot = round
    ? `<c:${ch.type === 'pie' ? 'pieChart' : 'doughnutChart'}><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/>${ch.type === 'doughnut' ? '<c:holeSize val="58"/>' : ''}</c:${ch.type === 'pie' ? 'pieChart' : 'doughnutChart'}>`
    : ch.type === 'line'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>${axes}`
      : `<c:barChart><c:barDir val="${ch.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="60"/><c:overlap val="-10"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>${axes}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"><a:solidFill><a:srgbClr val="1B5E3B"/></a:solidFill></a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    + `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>`
    + `<c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D5DDD8"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function drawingXml(charts: Chart[], firstRid: number) {
  const anchors = charts.map((c, i) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:to><xdr:col>${c.at.col + c.at.w}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.at.row + c.at.h}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId${firstRid + i}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">${anchors}</xdr:wsDr>`;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/** Builds the workbook as a Blob ready to download. */
export function buildXlsx(sheets: Sheet[]): Blob {
  const files: [string, string][] = [];
  const over: string[] = [];
  let chartNo = 0, drawNo = 0;
  sheets.forEach((sh, i) => {
    const charts = sh.charts ?? [];
    files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, charts.length > 0)]);
    over.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (!charts.length) return;
    drawNo++;
    files.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, rels([['drawing', `../drawings/drawing${drawNo}.xml`]])]);
    files.push([`xl/drawings/drawing${drawNo}.xml`, drawingXml(charts, 1)]);
    over.push(`<Override PartName="/xl/drawings/drawing${drawNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const targets: [string, string][] = [];
    for (const ch of charts) {
      chartNo++;
      files.push([`xl/charts/chart${chartNo}.xml`, chartXml(ch, sh)]);
      over.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      targets.push(['chart', `../charts/chart${chartNo}.xml`]);
    }
    files.push([`xl/drawings/_rels/drawing${drawNo}.xml.rels`, rels(targets)]);
  });
  const filters = sheets.map((sh, i) => sh.filter
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quote(sh.name))}!${ref(0, sh.filter.row, true)}:${ref(sh.filter.cols - 1, sh.filter.last, true)}</definedName>` : '').join('');
  files.unshift(
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${over.join('')}</Types>`],
    ['_rels/.rels', rels([['officeDocument', 'xl/workbook.xml']])],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', rels([...sheets.map((_, i): [string, string] => ['worksheet', `worksheets/sheet${i + 1}.xml`]), ['styles', 'styles.xml']])],
    ['xl/styles.xml', STYLES_XML],
  );
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- zip (stored, no compression) ----
// shortcut: entries are stored uncompressed; fine for report-sized files, switch to CompressionStream('deflate-raw') if exports get large.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files: [string, string][]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const loc = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nb.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => (s === 4 ? loc.setUint32(o, v, true) : loc.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nb.length, 2],
      [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, s]) => (s === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(new Uint8Array(loc.buffer), nb, data);
    central.push(new Uint8Array(cen.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([o, v, s]) => (s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
