import { MEMORY_KINDS, type MemoryCandidate, type MemoryItem, type MemoryKind } from '@/lib/memories/types';

const KIND_SET = new Set<string>(MEMORY_KINDS);
const SECTION_TO_KIND: Record<string, MemoryKind> = {
  preference: 'preference',
  preferences: 'preference',
  instruction: 'instruction',
  instructions: 'instruction',
  profile: 'profile',
  profiles: 'profile',
  decision: 'decision',
  decisions: 'decision',
};

export type ParsedMemoryMarkdownItem = MemoryCandidate & {
  enabled: boolean;
};

function titleCase(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Serialize account memories into a human-editable MEMORY.md. */
export function serializeMemoriesMarkdown(
  memories: Array<Pick<MemoryItem, 'kind' | 'content' | 'enabled'>>,
): string {
  const enabled = memories.filter(
    (m) => m.enabled !== false && String(m.content || '').trim(),
  );
  const disabled = memories.filter(
    (m) => m.enabled === false && String(m.content || '').trim(),
  );

  const lines: string[] = [
    '# Memory',
    '',
    'Account-level durable preferences and decisions.',
    'One bullet = one memory. Edit this file and import it back to update.',
    '',
    'Kinds: `preference` | `instruction` | `profile` | `decision`',
    '',
  ];

  for (const kind of MEMORY_KINDS) {
    const items = enabled.filter(
      (m) => String(m.kind || '').toLowerCase() === kind,
    );
    if (!items.length) continue;
    lines.push(`## ${titleCase(kind)}`, '');
    for (const item of items) {
      lines.push(`- ${String(item.content).trim()}`);
    }
    lines.push('');
  }

  // Catch enabled items with unknown/missing kind.
  const leftovers = enabled.filter(
    (m) => !KIND_SET.has(String(m.kind || '').toLowerCase()),
  );
  if (leftovers.length) {
    lines.push('## Preference', '');
    for (const item of leftovers) {
      lines.push(`- ${String(item.content).trim()}`);
    }
    lines.push('');
  }

  if (disabled.length) {
    lines.push('## Disabled', '');
    for (const item of disabled) {
      const kind = KIND_SET.has(String(item.kind || '').toLowerCase())
        ? String(item.kind).toLowerCase()
        : 'preference';
      lines.push(`- [${kind}] ${String(item.content).trim()}`);
    }
    lines.push('');
  }

  if (enabled.length === 0 && disabled.length === 0) {
    lines.push('## Preference', '', '- (no memories yet)', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function parseBullet(
  raw: string,
  fallbackKind: MemoryKind,
): { kind: MemoryKind; content: string } | null {
  const text = String(raw || '').trim().replace(/^[-*+]\s+/, '').trim();
  if (!text || text === '(no memories yet)') return null;

  const tagged = text.match(/^\[([a-zA-Z_]+)\]\s*(.+)$/);
  if (tagged) {
    const kindRaw = tagged[1].trim().toLowerCase();
    const content = tagged[2].trim().replace(/\s+/g, ' ');
    if (!content || content.length > 500) return null;
    if (!KIND_SET.has(kindRaw)) return null;
    return { kind: kindRaw as MemoryKind, content };
  }

  const content = text.replace(/\s+/g, ' ');
  if (!content || content.length > 500) return null;
  return { kind: fallbackKind, content };
}

/**
 * Parse MEMORY.md / free-form memory markdown into candidates.
 * Supports:
 * - section headings: ## Preference / ## Instruction / ...
 * - tagged bullets: - [preference] ...
 * - ## Disabled section (imported as enabled:false)
 */
export function parseMemoriesMarkdown(markdown: string): ParsedMemoryMarkdownItem[] {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let currentKind: MemoryKind = 'preference';
  let inDisabled = false;
  const out: ParsedMemoryMarkdownItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1].trim().toLowerCase();
      if (title === 'memory' || title === 'memories') continue;
      if (title === 'disabled') {
        inDisabled = true;
        continue;
      }
      const mapped = SECTION_TO_KIND[title];
      if (mapped) {
        currentKind = mapped;
        inDisabled = false;
      }
      continue;
    }

    if (!/^\s*[-*+]\s+/.test(line)) continue;
    const parsed = parseBullet(line, currentKind);
    if (!parsed) continue;
    const key = `${parsed.kind}:${parsed.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: parsed.kind,
      content: parsed.content,
      enabled: !inDisabled,
    });
  }

  return out.slice(0, 200);
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
