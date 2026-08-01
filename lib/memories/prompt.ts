import {
  MEMORY_KINDS,
  type MemoryCandidate,
  type MemoryItem,
  type MemoryKind,
} from '@/lib/memories/types';

const KIND_SET = new Set<string>(MEMORY_KINDS);

export function formatMemoriesForSystemPrompt(
  memories: Array<Pick<MemoryItem, 'kind' | 'content'>>,
  limit = 30,
): string {
  const lines = memories
    .map((m) => ({
      kind: String(m.kind || '').trim(),
      content: String(m.content || '').trim(),
    }))
    .filter((m) => m.content)
    .slice(0, Math.max(1, limit))
    .map((m) => `- [${m.kind || 'fact'}] ${m.content}`);

  if (!lines.length) return '';
  return [
    'Known facts about the user (account memory). Treat as durable preferences/context unless the user overrides them in this chat:',
    ...lines,
  ].join('\n');
}

export const MEMORY_EXTRACTION_SYSTEM_PROMPT = [
  'You extract durable user memories from recent chat turns.',
  'Return ONLY valid JSON with this shape:',
  '{"memories":[{"kind":"preference|instruction|profile|decision","content":"...","confidence":0.0,"reason":"..."}]}',
  '',
  'Rules:',
  '- Only record long-lived preferences, instructions, profile facts, or explicit project decisions.',
  '- Prefer the user\'s explicit statements over assistant speculation.',
  '- Skip one-off debugging, secrets, passwords, tokens, and temporary status.',
  '- Keep each content under 200 Chinese characters or 120 English words.',
  '- If nothing should be remembered, return {"memories":[]}.',
  '- Do not invent facts. Do not copy the entire conversation.',
].join('\n');

export function buildMemoryExtractionUserPrompt(opts: {
  pendingMessages: Array<{ role: string; content: string }>;
  existingMemories?: Array<{ id?: string; kind?: string; content: string }>;
}): string {
  const pending = opts.pendingMessages
    .map((m) => `${m.role}: ${String(m.content || '').trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');

  const existing = (opts.existingMemories || [])
    .map((m) => `- (${m.id || 'new'}) [${m.kind || 'fact'}] ${m.content}`)
    .join('\n');

  return [
    'Existing related memories (for dedupe/update awareness):',
    existing || '(none)',
    '',
    'New conversation turns to inspect:',
    pending || '(none)',
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* fall through */
      }
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseMemoryExtractionResponse(text: string): MemoryCandidate[] {
  const parsed = extractJsonObject(text) as
    | { memories?: unknown }
    | MemoryCandidate[]
    | null;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.memories)
      ? parsed.memories
      : [];

  const out: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const kindRaw = String((item as MemoryCandidate).kind || '')
      .trim()
      .toLowerCase();
    if (!KIND_SET.has(kindRaw)) continue;
    const content = String((item as MemoryCandidate).content || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!content || content.length > 500) continue;
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const confidence = Number((item as MemoryCandidate).confidence);
    out.push({
      kind: kindRaw as MemoryKind,
      content,
      ...(Number.isFinite(confidence)
        ? { confidence: Math.min(1, Math.max(0, confidence)) }
        : {}),
      ...((item as MemoryCandidate).reason
        ? { reason: String((item as MemoryCandidate).reason).slice(0, 200) }
        : {}),
    });
  }
  return out.slice(0, 10);
}
