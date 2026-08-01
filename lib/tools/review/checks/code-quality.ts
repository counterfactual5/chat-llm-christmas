import type { ReviewCheck, ReviewCheckItem } from '@/lib/tools/review/types';
import { extractCodeBlocks } from '@/lib/tools/review/shared';

type CodeBlock = { lang: string; code: string };

type CodeLang = 'js' | 'py' | 'other';

const JS_FENCE_RE = /^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs|node)$/;
const PY_FENCE_RE = /^(py|python|python3)$/;

/** Models often omit the fence language, so fall back to sniffing the body. */
function inferCodeLang(block: CodeBlock): CodeLang {
  if (JS_FENCE_RE.test(block.lang)) return 'js';
  if (PY_FENCE_RE.test(block.lang)) return 'py';
  if (block.lang) return 'other';
  if (/\bdef\s+\w+\s*\(|\bimport\s+\w+\s*$|\bself\b|\belif\b/m.test(block.code)) return 'py';
  if (/\b(?:const|let|function|=>|export|require\()\b/.test(block.code)) return 'js';
  return 'other';
}

type CodeQualityRule = {
  id: string;
  re: RegExp;
  title: string;
  detail: string;
  severity: 'error' | 'warn';
  langs?: CodeLang[];
};

// Scoped to loop headers only — a bare `index <= arr.length` in an ordinary
// boundary check (e.g. "is this a valid insert position?") is correct, not a
// bug. Off-by-one is specifically about walking one step past the last index.
const OFF_BY_ONE_RE =
  /\bfor\s*\([^{)]*?<=\s*(?:\w+(?:\.\w+)*\.length\b|len\s*\([^)]*\))[^{)]*?\)|\bwhile\s*\([^{)]*?<=\s*(?:\w+(?:\.\w+)*\.length\b|len\s*\([^)]*\))[^{)]*?\)|\bwhile\s+[^:\n]*?<=\s*len\s*\([^)]*\)[^:\n]*:/;

const CODE_QUALITY_RULES: CodeQualityRule[] = [
  {
    id: 'off-by-one',
    re: OFF_BY_ONE_RE,
    title: 'Off-by-one loop bound',
    detail: '`<= length` runs one iteration past the last index — use `<`.',
    severity: 'error',
  },
  {
    id: 'mutable-default-arg',
    re: /def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|set\(\))/,
    title: 'Mutable default argument',
    detail: 'Python evaluates defaults once — use `None` and build inside the function.',
    severity: 'error',
    langs: ['py'],
  },
  {
    id: 'empty-catch',
    re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    title: 'Empty catch block',
    detail: 'Swallowing the error hides failures — log or rethrow.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'bare-except',
    re: /except\s*:\s*(?:\n|$)|except\s+BaseException\s*:/,
    title: 'Bare except',
    detail: 'Catches KeyboardInterrupt/SystemExit too — catch specific exceptions.',
    severity: 'warn',
    langs: ['py'],
  },
  {
    id: 'parseint-radix',
    re: /parseInt\s*\(\s*[^,()]+\)/,
    title: 'parseInt without radix',
    detail: 'Pass 10 explicitly, or use `Number()`.',
    severity: 'warn',
    langs: ['js'],
  },
  {
    id: 'float-equality',
    re: /[=!]==?\s*0\.\d+|\b0\.\d+\s*[=!]==?/,
    title: 'Floating-point equality',
    detail: 'Binary floats rarely compare equal — compare within an epsilon.',
    severity: 'warn',
  },
  {
    id: 'unawaited-promise',
    re: /^\s*(?!return|await|void|yield)(?:\w+\.)*\w+\([^)]*\)\.then\s*\([^)]*\)\s*;?\s*$/m,
    title: 'Floating promise',
    detail: 'A `.then()` chain with no await/catch loses errors — await it or add `.catch`.',
    severity: 'warn',
    langs: ['js'],
  },
];

const LOOSE_EQ_RE = /(?<![=!<>])(==|!=)(?!=)/g;

/**
 * `x == null` / `x != undefined` is a deliberate, widely-endorsed idiom that
 * catches both null and undefined in one check — not a coercion bug. Only
 * flag loose equality that isn't a null/undefined guard.
 */
function hasNonNullLooseEquality(code: string): boolean {
  for (const match of code.matchAll(LOOSE_EQ_RE)) {
    const idx = match.index ?? 0;
    const before = code.slice(Math.max(0, idx - 16), idx);
    const after = code.slice(idx + match[0].length, idx + match[0].length + 16);
    const isNullGuard =
      /(?:\bnull|\bundefined)\s*$/.test(before) || /^\s*(?:null\b|undefined\b)/.test(after);
    if (!isNullGuard) return true;
  }
  return false;
}

// Bare `state.x =` / `props.x =` is only a React bug inside React code — the
// same names are ordinary variables in state machines, reducers, game loops,
// etc. Require an actual React signal in the same block before flagging.
const REACT_CONTEXT_RE =
  /\buseState\b|\buseReducer\b|\bthis\.(?:state|props)\b|\bReact\.(?:Component|PureComponent)\b|\bextends\s+(?:React\.)?(?:Pure)?Component\b|<[A-Z]\w*[\s/>]|\breturn\s*\(?\s*<[a-zA-Z]/;
const STATE_PROPS_MUTATION_RE =
  /\b(?:state|props)(?:\.\w+)+\s*=(?!=)|\b(?:state|props)\[[^\]]+\]\s*=(?!=)/;

function hasReactStateMutation(code: string): boolean {
  return REACT_CONTEXT_RE.test(code) && STATE_PROPS_MUTATION_RE.test(code);
}

/** `.map(...)` returning JSX without a `key` prop. */
function hasMissingReactKey(code: string): boolean {
  const re = /\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*\(?\s*<([A-Za-z][\w.]*)([\s\S]{0,240})/g;
  for (const match of code.matchAll(re)) {
    const tail = match[2] || '';
    const openTag = tail.split('>')[0] || '';
    if (!/\bkey\s*=/.test(openTag)) return true;
  }
  return false;
}

export function buildCodeQualityCheck(assistantText: string): ReviewCheck | null {
  const blocks = extractCodeBlocks(assistantText);
  if (!blocks.length) return null;

  const items: ReviewCheckItem[] = [];
  const seen = new Set<string>();
  const add = (rule: { id: string; title: string; detail: string; severity: 'error' | 'warn' }) => {
    if (seen.has(rule.id) || items.length >= 10) return;
    seen.add(rule.id);
    items.push({ severity: rule.severity, title: rule.title, detail: rule.detail });
  };

  for (const block of blocks) {
    const lang = inferCodeLang(block);
    for (const rule of CODE_QUALITY_RULES) {
      if (rule.langs && !rule.langs.includes(lang)) continue;
      if (rule.re.test(block.code)) add(rule);
    }
    if (lang === 'js' && hasMissingReactKey(block.code)) {
      add({
        id: 'missing-react-key',
        title: 'List render without `key`',
        detail: 'React needs a stable `key` on mapped elements to reconcile correctly.',
        severity: 'warn',
      });
    }
    if (lang === 'js' && hasNonNullLooseEquality(block.code)) {
      add({
        id: 'loose-equality',
        title: 'Loose equality (== / !=)',
        detail: 'Type coercion causes surprises — prefer `===` / `!==`.',
        severity: 'warn',
      });
    }
    if (lang === 'js' && hasReactStateMutation(block.code)) {
      add({
        id: 'state-mutation',
        title: 'Direct state/props mutation',
        detail: 'React state must be replaced, not mutated, or renders are skipped.',
        severity: 'warn',
      });
    }
  }

  const errors = items.filter((i) => i.severity === 'error').length;
  return {
    id: 'code_quality',
    kind: 'code_quality',
    status: 'done',
    clean: items.length === 0,
    summary: items.length
      ? `${items.length} correctness smell(s)${errors ? `, ${errors} likely bug(s)` : ''} in ${blocks.length} code block(s)`
      : `No correctness smells in ${blocks.length} code block(s)`,
    items,
  };
}
