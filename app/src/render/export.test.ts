import {
  buildProvenance,
  composeSvg,
  crc32,
  exportFileName,
  insertPngTextChunks,
  parseViewBox,
  pngChunk,
  pngPixelSize,
  pngTextChunk,
  pngTextEntries,
  provenanceLines,
  sha256Hex,
  type ProvenanceInput,
} from './export.js';

const INPUT: ProvenanceInput = {
  fileName: 'model.dgm',
  sha256: 'ab'.repeat(32),
  appVersion: '1.2.3',
  exportedAt: new Date(Date.UTC(2026, 10, 4, 12, 30, 0)),
  coefficientMode: 'stdyx',
  weights: ['Weighted: w'],
  outAttached: true,
};

const VB = { x: 0, y: 0, width: 400, height: 300 };

describe('sha256Hex', () => {
  it('hashes the UTF-8 text (FIPS 180-2 test vector "abc")', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('buildProvenance', () => {
  it('records every field', () => {
    expect(buildProvenance(INPUT, { includeFileName: true })).toEqual({
      sourceFile: 'model.dgm',
      sha256: INPUT.sha256,
      appVersion: '1.2.3',
      exportedAt: '2026-11-04T12:30:00.000Z',
      coefficientMode: 'stdyx',
      weight: 'Weighted: w',
      outAttached: true,
    });
  });

  it('drops the file name when asked and keeps the hash', () => {
    const record = buildProvenance(INPUT, { includeFileName: false });
    expect(record).not.toHaveProperty('sourceFile');
    expect(record.sha256).toBe(INPUT.sha256);
    expect(provenanceLines(record).join('\n')).not.toContain('model.dgm');
  });

  it('says none for an unweighted model', () => {
    expect(buildProvenance({ ...INPUT, weights: [] }, { includeFileName: true }).weight).toBe('none');
  });

  it('lists renamed variables as display name (mplus name), and no line when none is renamed', () => {
    const displayNames = [
      { displayName: 'Anxiety', mplusName: 'FA' },
      { displayName: 'fb', mplusName: 'FB' },
    ];
    const lines = provenanceLines(buildProvenance({ ...INPUT, displayNames }, { includeFileName: true }));
    expect(lines).toContain('Display names: Anxiety (FA); fb (FB)');
    for (const none of [undefined, []]) {
      const record = buildProvenance({ ...INPUT, displayNames: none }, { includeFileName: true });
      expect(record).not.toHaveProperty('displayNames');
      expect(provenanceLines(record).some((l) => l.startsWith('Display names'))).toBe(false);
    }
  });

  it('wraps many display names over several visible lines, which made one line that shrank the export', () => {
    const displayNames = Array.from({ length: 10 }, (_, i) => ({ displayName: `Name${i}`, mplusName: `V${i}` }));
    const record = buildProvenance({ ...INPUT, displayNames }, { includeFileName: true });
    const lines = provenanceLines(record);
    const start = lines.findIndex((l) => l.startsWith('Display names: Name0 (V0)'));
    expect(lines.slice(start, start + 3)).toEqual([
      'Display names: Name0 (V0); Name1 (V1); Name2 (V2); Name3 (V3)',
      '  Name4 (V4); Name5 (V5); Name6 (V6); Name7 (V7)',
      '  Name8 (V8); Name9 (V9)',
    ]);
  });
});

describe('composeSvg', () => {
  const record = buildProvenance({ ...INPUT, fileName: 'a<b>&.dgm' }, { includeFileName: true });

  it('embeds the record as <metadata> and draws the visible block by default', () => {
    const { text, viewBox } = composeSvg({ body: '<g class="nodes"/>', viewBox: VB, record, showVisible: true });
    expect(text).toMatch(/<metadata id="mplusplus-provenance">.*<mpp:source-sha256>(ab){32}<\/mpp:source-sha256>.*<\/metadata>/);
    expect(text).toContain('<mpp:source-file>a&lt;b&gt;&amp;.dgm</mpp:source-file>');
    expect(text).toContain('<g class="provenance"');
    expect(text).toContain('>Source file: a&lt;b&gt;&amp;.dgm</text>');
    expect(viewBox.height).toBeGreaterThan(VB.height);
  });

  it('with the toggle off, keeps the metadata and draws no provenance text', () => {
    const { text, viewBox } = composeSvg({ body: '<g class="nodes"/>', viewBox: VB, record, showVisible: false });
    expect(text).toContain('<metadata id="mplusplus-provenance">');
    expect(text).not.toContain('class="provenance"');
    expect(text).not.toContain('<text');
    expect(viewBox).toEqual(VB);
  });

  it('paints a white sheet under the diagram, whatever the page theme', () => {
    const { text } = composeSvg({ body: '<g class="nodes"/>', viewBox: VB, record, showVisible: false });
    expect(text).toMatch(/<\/metadata><rect x="0" y="0" width="400" height="300" fill="#ffffff"\/><g class="nodes"\/>/);
  });

  it('gives the pixel size as width and height when asked, keeping the view box', () => {
    const { text } = composeSvg({ body: '', viewBox: VB, record, showVisible: false, pixelSize: { width: 800, height: 600 } });
    expect(text).toContain('width="800" height="600" viewBox="0 0 400 300"');
  });
});

describe('parseViewBox', () => {
  it('reads the attribute and falls back to the default when malformed', () => {
    expect(parseViewBox('-10 5 300 200')).toEqual({ x: -10, y: 5, width: 300, height: 200 });
    expect(parseViewBox(null)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(parseViewBox('0 0 0 10')).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });
});

describe('pngPixelSize', () => {
  it('uses 2x, shrinking a very large diagram to the canvas limits', () => {
    expect(pngPixelSize(VB)).toEqual({ width: 800, height: 600 });
    const big = pngPixelSize({ x: 0, y: 0, width: 10000, height: 2000 });
    expect(big.width).toBeLessThanOrEqual(8192);
    expect(big.width * big.height).toBeLessThanOrEqual(16_000_000);
  });
});

describe('exportFileName', () => {
  it('swaps the extension, or uses diagram when the name is left out', () => {
    expect(exportFileName('my.model.dgm', 'png', true)).toBe('my.model.png');
    expect(exportFileName('my.model.dgm', 'svg', false)).toBe('diagram.svg');
  });
});

describe('PNG text chunks', () => {
  const bytes = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
  const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);

  it('crc32 matches the standard check value and the IEND chunk CRC', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('IEND'))).toBe(0xae426082);
  });

  it('writes a tEXt chunk: length, type, keyword, null, text, CRC (checked with Python zlib)', () => {
    const chunk = pngTextChunk('Software', 'mplusplus 0.0.1');
    expect(u32(chunk, 0)).toBe(24);
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe('tEXt');
    expect(Array.from(chunk.subarray(8, 32))).toEqual(Array.from(bytes('Software\0mplusplus 0.0.1')));
    expect(u32(chunk, 32)).toBe(0xad101e5f);
    expect(chunk.length).toBe(36);
  });

  it('writes iTXt (UTF-8) for text outside Latin-1 (CRC checked with Python zlib)', () => {
    const chunk = pngTextChunk('mplusplus:source-file', 'モデル.dgm');
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe('iTXt');
    expect(u32(chunk, 0)).toBe(39);
    expect(u32(chunk, 8 + 39)).toBe(0x8e871e60);
  });

  it('inserts the chunks right after IHDR and keeps the rest', () => {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const ihdr = pngChunk('IHDR', new Uint8Array(13));
    const iend = pngChunk('IEND', new Uint8Array(0));
    const png = new Uint8Array([...sig, ...ihdr, ...iend]);
    const record = buildProvenance(INPUT, { includeFileName: false });
    const out = insertPngTextChunks(png, pngTextEntries(record));
    const types: string[] = [];
    for (let at = 8; at < out.length; at += 12 + u32(out, at)) types.push(String.fromCharCode(...out.subarray(at + 4, at + 8)));
    expect(types[0]).toBe('IHDR');
    expect(types.at(-1)).toBe('IEND');
    expect(types.slice(1, -1).every((t) => t === 'tEXt')).toBe(true);
    expect(types.length - 2).toBe(pngTextEntries(record).length);
    expect(Array.from(out.subarray(out.length - 12))).toEqual(Array.from(iend));
  });

  it('refuses bytes that are not a PNG', () => {
    expect(() => insertPngTextChunks(new Uint8Array(40), [])).toThrow('Not a PNG');
  });
});
