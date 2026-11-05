/**
 * Diagram export (SVG, PNG, and PDF through the browser's print) with
 * provenance: where the diagram came from, recorded both as a small text
 * block on the diagram (unless hidden) and as metadata (SVG `<metadata>`,
 * PNG text chunks). A print to PDF carries only the visible block.
 *
 * The decisions (provenance fields, both visible and embedded by default,
 * the file name optional and the hash always kept) are Amelia's, 2026-11-01
 * and 2026-11-03 (`TODO.md`). Everything up to the DOM is pure and tested:
 * the provenance record, the SVG text and the PNG chunks.
 * `exportDiagram` is the thin DOM part.
 */
import { version as packageVersion } from '../../package.json';
import { DEFAULT_VIEWBOX, formatViewBox, placeCaption, widenToFit, type ViewBox } from '../ui/viewBox.js';
import type { DisplayNamePair } from './styles.js';

/** The app's version, from `package.json` at build time. */
export const APP_VERSION: string = packageVersion;

export type ExportKind = 'svg' | 'png' | 'pdf';
export type CoefficientMode = 'unstd' | 'stdyx';

/** Everything an export needs from the open diagram. */
export interface ExportSource {
  /** The live canvas; it is cloned, never changed. */
  svg: SVGSVGElement;
  /** The source file's name, as loaded. */
  fileName: string;
  /** The source file's text, hashed for the provenance. */
  fileText: string;
  coefficientMode: CoefficientMode;
  /** The diagram's weight captions (`model/caption.ts`), empty when unweighted. */
  weights: string[];
  /** Whether a `.out` file's p-values are attached. */
  outAttached: boolean;
  /** The renamed variables (`displayNamePairs` in `styles.ts`); none when absent. */
  displayNames?: DisplayNamePair[];
  /** Defaults to `APP_VERSION`. */
  appVersion?: string;
}

/** The user's choices in the export dialog. */
export interface ExportChoices {
  /** Record the source file name; the hash is kept either way. */
  includeFileName: boolean;
  /** Draw the provenance block on the diagram. */
  showVisible: boolean;
}

export const DEFAULT_EXPORT_CHOICES: Readonly<ExportChoices> = { includeFileName: true, showVisible: true };

export interface ProvenanceRecord {
  /** Absent when the user left the file name out. */
  sourceFile?: string;
  /** SHA-256 of the source file's text (UTF-8), lowercase hex. */
  sha256: string;
  appVersion: string;
  /** ISO 8601, UTC. */
  exportedAt: string;
  coefficientMode: CoefficientMode;
  /** The weight captions joined, or `none`. */
  weight: string;
  outAttached: boolean;
  /** Variables drawn under a display name, with their Mplus names; absent when none is renamed. */
  displayNames?: DisplayNamePair[];
}

/** One provenance field: a key for metadata, a label for people, a value. */
export interface ProvenanceEntry {
  key: string;
  label: string;
  value: string;
}

/** SHA-256 of `text` encoded as UTF-8, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ProvenanceInput {
  fileName: string;
  sha256: string;
  appVersion: string;
  exportedAt: Date;
  coefficientMode: CoefficientMode;
  weights: string[];
  outAttached: boolean;
  displayNames?: DisplayNamePair[];
}

export function buildProvenance(input: ProvenanceInput, choices: Pick<ExportChoices, 'includeFileName'>): ProvenanceRecord {
  const record: ProvenanceRecord = {
    sha256: input.sha256,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt.toISOString(),
    coefficientMode: input.coefficientMode,
    weight: input.weights.length > 0 ? input.weights.join('; ') : 'none',
    outAttached: input.outAttached,
  };
  if (choices.includeFileName) record.sourceFile = input.fileName;
  if (input.displayNames && input.displayNames.length > 0) record.displayNames = input.displayNames.map((p) => ({ ...p }));
  return record;
}

/** The renamed variables as `display name (mplus name)`, joined with `; `. */
export function formatDisplayNames(pairs: readonly DisplayNamePair[]): string {
  return pairs.map((p) => `${p.displayName} (${p.mplusName})`).join('; ');
}

const COEFFICIENT_LABELS: Record<CoefficientMode, string> = {
  unstd: 'unstandardized',
  stdyx: 'STDYX standardized',
};

/** The record's fields in a fixed order, the file name only when recorded. */
export function provenanceEntries(record: ProvenanceRecord): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];
  if (record.sourceFile !== undefined) entries.push({ key: 'source-file', label: 'Source file', value: record.sourceFile });
  entries.push(
    { key: 'source-sha256', label: 'Source SHA-256', value: record.sha256 },
    { key: 'app-version', label: 'mplusplus version', value: record.appVersion },
    { key: 'exported-at', label: 'Exported', value: record.exportedAt },
    { key: 'coefficients', label: 'Coefficients', value: COEFFICIENT_LABELS[record.coefficientMode] },
    { key: 'weight', label: 'Weight', value: record.weight },
    { key: 'out-attached', label: '.out attached', value: record.outAttached ? 'yes' : 'no' },
  );
  if (record.displayNames && record.displayNames.length > 0) {
    entries.push({ key: 'display-names', label: 'Display names', value: formatDisplayNames(record.displayNames) });
  }
  return entries;
}

/** The visible block's lines. */
export function provenanceLines(record: ProvenanceRecord): string[] {
  return provenanceEntries(record).map((e) => `${e.label}: ${e.value}`);
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Namespace of the metadata elements: a name, not a link. */
export const PROVENANCE_NS = 'urn:mplusplus:provenance:1';

/** The `<metadata>` element holding the record. */
export function provenanceMetadata(record: ProvenanceRecord): string {
  const fields = provenanceEntries(record)
    .map((e) => `<mpp:${e.key}>${escapeXml(e.value)}</mpp:${e.key}>`)
    .join('');
  return `<metadata id="mplusplus-provenance"><mpp:provenance xmlns:mpp="${PROVENANCE_NS}">${fields}</mpp:provenance></metadata>`;
}

/** The view box from a `viewBox` attribute, or the default when it is missing or malformed. */
export function parseViewBox(attr: string | null): ViewBox {
  const parts = (attr ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2]! <= 0 || parts[3]! <= 0) {
    return { ...DEFAULT_VIEWBOX };
  }
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

/**
 * A generous estimate of a line's width: no text measuring outside the DOM,
 * and a block cut off at the edge would lose the hash.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

export const PROVENANCE_FONT_FAMILY = 'system-ui, sans-serif';
const PROVENANCE_FONT_SCALE = 0.75;

export interface ComposeSvgInput {
  /** The diagram's markup: the canvas's children, cleaned (`cleanCanvasClone`). */
  body: string;
  /** The canvas's view box. */
  viewBox: ViewBox;
  record: ProvenanceRecord;
  showVisible: boolean;
  /** Width and height attributes in pixels; the view box's size when absent. */
  pixelSize?: { width: number; height: number };
}

export interface ComposedSvg {
  text: string;
  /** The final view box, with room for the visible block. */
  viewBox: ViewBox;
}

/**
 * A standalone SVG document: a white sheet (the canvas is white in both
 * themes, and exports must not pick up page colors), the diagram, the
 * visible provenance block under it unless hidden, and the metadata.
 */
export function composeSvg(input: ComposeSvgInput): ComposedSvg {
  let vb = input.viewBox;
  let visible = '';
  if (input.showVisible) {
    const lines = provenanceLines(input.record);
    const place = placeCaption(vb, lines.length);
    const fontSize = place.fontSize * PROVENANCE_FONT_SCALE;
    const lineHeight = place.lineHeight * PROVENANCE_FONT_SCALE;
    const x = place.at.x;
    const y0 = vb.y + vb.height + 1.2 * fontSize;
    vb = { ...vb, height: vb.height + lines.length * lineHeight + fontSize };
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
    vb = widenToFit(vb, x, widest);
    const texts = lines
      .map((l, i) => `<text x="${x}" y="${y0 + i * lineHeight}">${escapeXml(l)}</text>`)
      .join('');
    visible = `<g class="provenance" font-family="${PROVENANCE_FONT_FAMILY}" font-size="${fontSize}" fill="#555555">${texts}</g>`;
  }
  const width = input.pixelSize?.width ?? vb.width;
  const height = input.pixelSize?.height ?? vb.height;
  const text =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="${formatViewBox(vb)}">` +
    provenanceMetadata(input.record) +
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.width}" height="${vb.height}" fill="#ffffff"/>` +
    input.body +
    visible +
    `</svg>\n`;
  return { text, viewBox: vb };
}

/**
 * The PNG's pixel size: `scale` pixels per view box unit, shrunk to stay
 * within what browsers' canvases allow (`maxSide` per side, `maxArea` in all).
 */
export function pngPixelSize(
  vb: ViewBox,
  scale = 2,
  maxSide = 8192,
  maxArea = 16_000_000,
): { width: number; height: number } {
  let s = scale;
  s = Math.min(s, maxSide / vb.width, maxSide / vb.height);
  s = Math.min(s, Math.sqrt(maxArea / (vb.width * vb.height)));
  return { width: Math.max(1, Math.floor(vb.width * s)), height: Math.max(1, Math.floor(vb.height * s)) };
}

/** The download's name: the source's name with the export's extension, or `diagram` when the name is left out. */
export function exportFileName(fileName: string, kind: Exclude<ExportKind, 'pdf'>, includeFileName: boolean): string {
  const base = includeFileName ? fileName.replace(/\.[^./\\]*$/, '') : '';
  return `${base || 'diagram'}.${kind}`;
}

// ---- PNG text chunks ----

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG uses it (ISO 3309, the same as zlib's). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return false;
  return true;
}

function latin1Bytes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

/** A whole chunk: length, type, data, CRC over type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(latin1Bytes(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A text chunk for `keyword` (1 to 79 Latin-1 characters, no null): `tEXt`
 * when the text is Latin-1, as the PNG specification requires of `tEXt`;
 * otherwise `iTXt` (uncompressed UTF-8), so a file name in any script
 * survives.
 */
export function pngTextChunk(keyword: string, text: string): Uint8Array {
  if (keyword.length < 1 || keyword.length > 79 || !isLatin1(keyword) || keyword.includes('\0')) {
    throw new Error(`Invalid PNG text keyword: ${keyword}`);
  }
  const clean = text.replace(/\0/g, '');
  if (isLatin1(clean)) {
    return pngChunk('tEXt', new Uint8Array([...latin1Bytes(keyword), 0, ...latin1Bytes(clean)]));
  }
  // keyword, null, compression flag 0, method 0, empty language tag and
  // translated keyword (each null-terminated), then UTF-8 text.
  const utf8 = new TextEncoder().encode(clean);
  return pngChunk('iTXt', new Uint8Array([...latin1Bytes(keyword), 0, 0, 0, 0, 0, ...utf8]));
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG text entries for a record: `Software`, then one per field. */
export function pngTextEntries(record: ProvenanceRecord): Array<[keyword: string, text: string]> {
  return [
    ['Software', `mplusplus ${record.appVersion}`],
    ...provenanceEntries(record).map((e): [string, string] => [`mplusplus:${e.key}`, e.value]),
  ];
}

/** `png` with text chunks inserted right after `IHDR`. Throws when `png` is not a PNG. */
export function insertPngTextChunks(png: Uint8Array, entries: Array<[string, string]>): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('Not a PNG file');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrType = String.fromCharCode(...png.subarray(12, 16));
  if (ihdrType !== 'IHDR') throw new Error('PNG does not start with IHDR');
  const afterIhdr = 8 + 12 + view.getUint32(8);
  const chunks = entries.map(([k, t]) => pngTextChunk(k, t));
  const added = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + added);
  out.set(png.subarray(0, afterIhdr), 0);
  let at = afterIhdr;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  out.set(png.subarray(afterIhdr), at);
  return out;
}

// ---- DOM ----

/**
 * The canvas's markup without the interaction layers: the marquee, the wide
 * transparent hit paths and selection classes.
 */
export function cleanCanvasClone(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('g.marquee, path.edge-hit').forEach((el) => el.remove());
  clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  const serializer = new XMLSerializer();
  return Array.from(clone.childNodes, (n) => serializer.serializeToString(n)).join('');
}

/** The provenance record for `source`, hashing its text. */
export async function provenanceFor(source: ExportSource, choices: Pick<ExportChoices, 'includeFileName'>, now = new Date()): Promise<ProvenanceRecord> {
  return buildProvenance(
    {
      fileName: source.fileName,
      sha256: await sha256Hex(source.fileText),
      appVersion: source.appVersion ?? APP_VERSION,
      exportedAt: now,
      coefficientMode: source.coefficientMode,
      weights: source.weights,
      outAttached: source.outAttached,
      displayNames: source.displayNames,
    },
    choices,
  );
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rasterize(svgText: string, size: { width: number; height: number }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No 2D canvas'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(img, 0, 0, size.width, size.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be made'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The diagram could not be drawn as an image'));
    };
    img.src = url;
  });
}

/** Class on `<body>` while the print sheet is shown (`style.css`, print block). */
export const PRINT_CLASS = 'print-export';
const PRINT_SHEET_ID = 'print-sheet';

/**
 * Print the composed SVG alone. It goes on the page as an image, a document
 * of its own, so its marker ids cannot resolve to the live canvas's markers
 * (which print hides) and the arrowheads stay. Prints once the image loads.
 */
function printSheet(svgText: string): Promise<void> {
  return new Promise((resolve, reject) => {
    document.getElementById(PRINT_SHEET_ID)?.remove();
    const sheet = document.createElement('div');
    sheet.id = PRINT_SHEET_ID;
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const img = new Image();
    img.alt = 'Diagram';
    const done = () => {
      document.body.classList.remove(PRINT_CLASS);
      sheet.remove();
      URL.revokeObjectURL(url);
      window.removeEventListener('afterprint', done);
    };
    img.onload = () => {
      window.addEventListener('afterprint', done);
      window.print();
      resolve();
    };
    img.onerror = () => {
      done();
      reject(new Error('The diagram could not be drawn for printing'));
    };
    sheet.append(img);
    document.body.append(sheet);
    document.body.classList.add(PRINT_CLASS);
    img.src = url;
  });
}

/**
 * Export the diagram: download an SVG or PNG, or open the print dialog with
 * the diagram alone on the page (save as PDF there).
 */
export async function exportDiagram(kind: ExportKind, source: ExportSource, choices: ExportChoices): Promise<void> {
  const record = await provenanceFor(source, choices);
  const body = cleanCanvasClone(source.svg);
  const viewBox = parseViewBox(source.svg.getAttribute('viewBox'));
  if (kind === 'svg') {
    const { text } = composeSvg({ body, viewBox, record, showVisible: choices.showVisible });
    download(new Blob([text], { type: 'image/svg+xml' }), exportFileName(source.fileName, 'svg', choices.includeFileName));
  } else if (kind === 'png') {
    const sized = composeSvg({ body, viewBox, record, showVisible: choices.showVisible });
    const pixelSize = pngPixelSize(sized.viewBox);
    const { text } = composeSvg({ body, viewBox, record, showVisible: choices.showVisible, pixelSize });
    const png = new Uint8Array(await (await rasterize(text, pixelSize)).arrayBuffer());
    const tagged = insertPngTextChunks(png, pngTextEntries(record));
    // `tagged` is a fresh array spanning its whole (non-shared) buffer.
    download(new Blob([tagged.buffer as ArrayBuffer], { type: 'image/png' }), exportFileName(source.fileName, 'png', choices.includeFileName));
  } else {
    const { text } = composeSvg({ body, viewBox, record, showVisible: choices.showVisible });
    await printSheet(text);
  }
}
