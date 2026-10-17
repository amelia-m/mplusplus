/**
 * File loading: reads a dropped or picked `File` and runs it through the
 * parsers. A `.dgm` goes through `parseDgm` and `buildGraph`; a `.out` goes
 * through `parseOut` and `buildPValueMap`. `classifyFile` picks the path by
 * file extension.
 */
import { parseDgm, type DgmFile } from '../parser/dgm.js';
import { buildGraph, type ModelGraph } from '../model/graph.js';
import { parseOut, buildPValueMap, type ParsedOut } from '../parser/out.js';

export interface LoadedDgm {
  file: File;
  parsed: DgmFile;
  graph: ModelGraph;
}

export async function loadDgmFile(file: File): Promise<LoadedDgm> {
  const text = await file.text();
  const parsed = parseDgm(text);
  const graph = buildGraph(parsed);
  return { file, parsed, graph };
}

export interface LoadedOut {
  file: File;
  parsed: ParsedOut;
  /** Per-edge p-values keyed by `kind:from->to`. */
  pValues: Record<string, { unstd: number | null; stdyx: number | null }>;
}

export async function loadOutFile(file: File): Promise<LoadedOut> {
  const text = await file.text();
  const parsed = parseOut(text);
  const pValues = buildPValueMap(parsed);
  return { file, parsed, pValues };
}

/** Detect file kind by extension; content sniffing not required for v1. */
export function classifyFile(file: File): 'dgm' | 'out' | 'unknown' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.dgm')) return 'dgm';
  if (name.endsWith('.out')) return 'out';
  return 'unknown';
}
