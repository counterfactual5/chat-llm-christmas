/**
 * Single catalog of text/code file extensions → MIME + highlight language.
 * create_file, preview routing, and FilePreviewOverlay all read from here.
 */

export type TextFileTypeEntry = {
  mime: string;
  /** highlight.js / CodeBlock language id */
  language: string;
};

/** Extension (no dot) → MIME + highlight language. */
export const TEXT_FILE_TYPES: Record<string, TextFileTypeEntry> = {
  md: { mime: 'text/markdown', language: 'markdown' },
  markdown: { mime: 'text/markdown', language: 'markdown' },
  txt: { mime: 'text/plain', language: 'plaintext' },
  text: { mime: 'text/plain', language: 'plaintext' },
  py: { mime: 'text/x-python', language: 'python' },
  js: { mime: 'text/javascript', language: 'javascript' },
  mjs: { mime: 'text/javascript', language: 'javascript' },
  cjs: { mime: 'text/javascript', language: 'javascript' },
  ts: { mime: 'text/typescript', language: 'typescript' },
  tsx: { mime: 'text/tsx', language: 'typescript' },
  jsx: { mime: 'text/jsx', language: 'javascript' },
  json: { mime: 'application/json', language: 'json' },
  csv: { mime: 'text/csv', language: 'plaintext' },
  tsv: { mime: 'text/tab-separated-values', language: 'plaintext' },
  yaml: { mime: 'text/yaml', language: 'yaml' },
  yml: { mime: 'text/yaml', language: 'yaml' },
  html: { mime: 'text/html', language: 'xml' },
  htm: { mime: 'text/html', language: 'xml' },
  css: { mime: 'text/css', language: 'css' },
  sql: { mime: 'application/sql', language: 'sql' },
  sh: { mime: 'application/x-sh', language: 'bash' },
  bash: { mime: 'application/x-sh', language: 'bash' },
  xml: { mime: 'application/xml', language: 'xml' },
  toml: { mime: 'application/toml', language: 'plaintext' },
  ini: { mime: 'text/plain', language: 'plaintext' },
  env: { mime: 'text/plain', language: 'plaintext' },
  rs: { mime: 'text/x-rust', language: 'rust' },
  go: { mime: 'text/x-go', language: 'go' },
  java: { mime: 'text/x-java-source', language: 'java' },
  kt: { mime: 'text/x-kotlin', language: 'kotlin' },
  swift: { mime: 'text/x-swift', language: 'swift' },
  rb: { mime: 'text/x-ruby', language: 'ruby' },
  php: { mime: 'application/x-httpd-php', language: 'php' },
  c: { mime: 'text/x-c', language: 'c' },
  h: { mime: 'text/x-c', language: 'c' },
  cpp: { mime: 'text/x-c++', language: 'cpp' },
  hpp: { mime: 'text/x-c++', language: 'cpp' },
  cs: { mime: 'text/x-csharp', language: 'csharp' },
};

export function fileExt(name: string): string {
  const base = String(name || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mimeFromFilename(filename: string, explicit?: string): string {
  const given = String(explicit || '')
    .trim()
    .toLowerCase();
  if (given && /^[\w.+-]+\/[\w.+-]+$/.test(given)) return given;
  return TEXT_FILE_TYPES[fileExt(filename)]?.mime || 'text/plain';
}

export function languageFromFilename(name: string): string {
  return TEXT_FILE_TYPES[fileExt(name)]?.language || 'plaintext';
}

/** True when the filename extension is in the text/code catalog. */
export function isKnownTextFileExt(name: string): boolean {
  return Boolean(TEXT_FILE_TYPES[fileExt(name)]);
}
