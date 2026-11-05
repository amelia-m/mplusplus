import { describe, expect, it } from 'vitest';
import { pdfProvenanceWarning } from './exportDialog.js';

describe('pdfProvenanceWarning', () => {
  it('warns for a PDF with the provenance block unticked', () => {
    expect(pdfProvenanceWarning('pdf', { showVisible: false })).toMatch(/no record of its source/);
  });

  it('says nothing for a PDF with the block shown', () => {
    expect(pdfProvenanceWarning('pdf', { showVisible: true })).toBeNull();
  });

  it('says nothing for SVG or PNG, which keep the record as metadata', () => {
    expect(pdfProvenanceWarning('svg', { showVisible: false })).toBeNull();
    expect(pdfProvenanceWarning('png', { showVisible: false })).toBeNull();
  });
});
