/**
 * Ingest slimming contract: the browser no longer produces authoritative
 * extract for docs (pdf/docx/epub/pptx/xlsx/zip). Those upload as opaque bytes;
 * chat-api is the single source of truth (see
 * docs/plans/2026-08-07-008-feat-server-authority-anydoc-parsing-plan.md U4a).
 */
import { describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/files/ingest';

function file(name: string, type: string, contents: BlobPart = 'x'): File {
  return new File([contents], name, { type });
}

describe('ingestFile — thin client (server-authority parsing)', () => {
  it('text/plain: populates inline text (chat composer wants it)', async () => {
    const f = file('notes.txt', 'text/plain', 'hello world');
    const out = await ingestFile(f);
    expect(out.name).toBe('notes.txt');
    expect(out.type).toBe('text/plain');
    expect(out.text).toBe('hello world');
    expect(out.uploadBlob).toBeDefined();
  });

  it('pdf: no text, just blob + mime', async () => {
    const f = file('report.pdf', 'application/pdf', '%PDF-1.7 fake');
    const out = await ingestFile(f);
    expect(out.type).toBe('application/pdf');
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('docx: no text, just blob + mime', async () => {
    const f = file(
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'PK-fake',
    );
    const out = await ingestFile(f);
    expect(out.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('epub: no text, just blob + mime', async () => {
    const f = file('book.epub', 'application/epub+zip', 'PK-fake');
    const out = await ingestFile(f);
    expect(out.type).toBe('application/epub+zip');
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('pptx: no text, just blob + defaulted mime', async () => {
    const f = file('deck.pptx', '', 'PK-fake');
    const out = await ingestFile(f);
    expect(out.type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('xlsx: no text, just blob + defaulted mime', async () => {
    const f = file('sales.xlsx', '', 'PK-fake');
    const out = await ingestFile(f);
    expect(out.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('zip: no text / no catalog, just opaque blob', async () => {
    const f = file('bundle.zip', 'application/zip', 'PK-fake');
    const out = await ingestFile(f);
    expect(out.type).toBe('application/zip');
    expect(out.text).toBeUndefined();
    expect(out.uploadBlob).toBe(f);
  });

  it('legacy .doc throws (never supported)', async () => {
    const f = file('legacy.doc', 'application/msword', 'OLE-fake');
    await expect(ingestFile(f)).rejects.toThrow(/Legacy \.doc is not supported/i);
  });

  it('legacy .ppt throws (never supported)', async () => {
    const f = file('legacy.ppt', 'application/vnd.ms-powerpoint', 'OLE-fake');
    await expect(ingestFile(f)).rejects.toThrow(/Legacy \.ppt is not supported/i);
  });
});
