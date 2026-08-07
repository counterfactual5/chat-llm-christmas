/**
 * E2E check that the anydoc-wasm path produces a valid paged extract for a
 * real DOCX. Runs in vitest so webpack alias + asset pipeline mirror prod.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingestFile } from '@/lib/files/ingest';

const SAMPLE = '/tmp/ingest-samples/tables.docx';

describe('ingestFile DOCX via anydoc', () => {
  it('produces a paged extract with markdown table content', async () => {
    const bytes = readFileSync(SAMPLE);
    const file = new File([bytes], 'tables.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const result = await ingestFile(file);
    expect(result.name).toBe('tables.docx');
    const text = String(result.text || '');
    // Paged-extract markers
    expect(text).toContain('--- page 1 ---');
    // Catalog title mentions anydoc so we know which pipeline ran
    expect(text).toContain('anydoc');
    // Body is the document's markdown
    expect(text).toContain('| Top left | Top right |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| Bottom left | Bottom right |');
  }, 30_000);
});
