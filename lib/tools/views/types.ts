/**
 * Specialized tool-result views (专项视图).
 * Not a generic file preview, and not a full Office editor.
 */

export type ToolViewPayload = {
  id: string;
  viewType: string;
  title: string;
  sourceFileId?: string;
  sourceFileName?: string;
  createdAt: number;
  data: unknown;
};

/** `docx.extract` — document body split into titled markdown sections. */
export type DocxExtractViewData = {
  sections: Array<{ title?: string; markdown: string }>;
};

/** `docx.outline` — heading outline only. */
export type DocxOutlineViewData = {
  headings: Array<{ level: number; text: string }>;
};

/** `docx.comments` — comment list. */
export type DocxCommentsViewData = {
  comments: Array<{
    id?: string;
    author?: string;
    body: string;
    date?: string;
  }>;
};

/** `xlsx.table` — simple sheet table for HTML rendering. */
export type XlsxTableViewData = {
  sheetName?: string;
  headers?: string[];
  rows: string[][];
  /** All sheet names in the workbook (for picker / model). */
  sheetNames?: string[];
  /** Preparsed tables so the UI can switch sheets without re-fetch. */
  tables?: Array<{ sheetName: string; headers?: string[]; rows: string[][] }>;
  /** True when the active sheet has no rows/headers. */
  empty?: boolean;
};
