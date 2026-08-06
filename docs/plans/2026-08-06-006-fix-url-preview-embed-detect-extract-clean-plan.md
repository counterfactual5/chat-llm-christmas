---
title: "fix: URL Preview blocked-embed degrade and extract cleanup"
date: 2026-08-06
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: fix
---

# fix: URL Preview blocked-embed degrade and extract cleanup

**Target repos:** `chat-llm-christmas` (this repo) + `chat-api` (sibling at `~/Work/chat-api`, paths in U4/U5 are relative to `chat-api/`).

## Goal Capsule

When a site refuses framing (X-Frame-Options / CSP), the URL Preview should stop showing a stranded gray iframe and instead degrade into Text (extract) with a clear notice. Independently, the extract body should be cleaned of provider wrappers and obvious nav noise so Text mode reads like an article, at both the shared server cleaner (`chat-api`) and a conservative client-side belt.

**Stop when:** a blocked cross-origin embed reliably lands the user in usable Text mode with honest messaging (no stuck “broken document” pane, no layout collapse); extract drops Jina-style chrome headers, placeholder `Image N` references, and obvious nav link-clusters without eating real content; unit tests cover detection heuristics + cleaning on both repos; embeds that DO work keep unchanged full-bleed layout and Quote-extract behavior.

**Authority:** session-settled — user chose **full scope**: embed-failure degrade + extract cleaning, **with chat-api upstream included in this batch**. PR #27/#28 (Quote iframe bridge + preview layout/mode) are merged context, not work items.

---

## Product Contract

### Summary

URL Preview has two modes: `iframe` (embed) and `extract` (Text). Sites like Zhihu send `X-Frame-Options: DENY`; the browser then paints a broken-document icon while our server-side `web_read` still extracts text fine. Today the panel leaves the user staring at the dead iframe. Separately, extract content carries provider chrome (`Title:`/`URL Source:`/`Markdown Content:` headers from Jina keyless, nav link clusters, `[Image N]` placeholders) that makes Text mode look like a raw dump.

### Problem Frame

- **Blocked embeds are silent.** `iframe.onLoad` is not a reliable “blocked” signal: many browsers fire `load` on the error document, and `iframe.onerror` often does NOT fire for XFO refusals. The current sandbox (`allow-scripts allow-same-origin allow-popups allow-forms`) lets us attempt a probing read; response headers are not readable from JS, so detection must be heuristic.
- **Extract chrome leaks through every provider up front.** `chat-api`’s `web_read` chain returns provider-shaped bodies (Jina keyless emits a plain-text header block; Tavily/Jina keyed emit clean markdown; Zhipu emits its own shape, bare-fetch is already cleaned). No provider-agnostic normalization layer exists at the source, so every consumer inherits the noise.
- **Cleaning must stay lossless on the happy path.** Both layers must only strip known wrapper/pattern noise and never reorder or trim genuine prose.

### Requirements

- R1. Cross-origin URL iframe embeds that fail to render (blocked by X-Frame-Options/CSP, or producing no readable document) must not leave a dead pane: auto-switch to Text with a one-line notice, when extract prefetch already has content.
- R2. Embeds that load successfully keep current behavior: full-bleed iframe, Quote banner, manual Embed/Text toggle. No auto-switch on slow-but-alive pages.
- R3. If embed fails AND extract is unavailable/loading/failed, show an actionable fallback (open externally + retry states) instead of the gray error document.
- R4. Server-side (`chat-api`) extract bodies are normalized: strip Jina-style header wrappers (`Title:`, `URL Source:`, `Markdown Content:`) and provider boilerplate regardless of provider, keeping `title`/metadata intact.
- R5. Server-side extract drops obvious placeholder image artifacts (`[Image 1]`-style lines / image-link lines with no real `src`) and collapses dense nav link-cluster runs, conservatively.
- R6. Client-side (`chat-llm-christmas`) applies a thin, idempotent cleaning of the same wrapper patterns before `AnswerMarkdown`, so even unpatched/stale chat-api responses render decently.
- R7. No new runtime dependencies in either repo; server cleaning adds a small shared helper + node:test coverage; panel changes keep existing Quote metadata attributes intact.

### Scope Boundaries

**In scope:** blocked-embed detection + degrade UX in `UrlPreviewPanel`; server-side extract normalization in `chat-api` `web_read` (single cleaner module + wiring); client-side conservative cleaning for URL preview extract; unit tests both repos; i18n strings EN/ZH; README touch.

**Out of scope:** bypassing X-Frame-Options via any proxy; cookie/login reuse for embed or web_read; readability-grade full rewrite of `extractFromHtml`'s scoring; per-site rules; changes to OCR/file previews/EPUB/PDF quote pipelines; chat-api deployment/ops beyond code + tests.

### Deferred to Follow-Up Work

- Structured provider metadata (e.g. passing `provider` to the client for provider-specific polish) once server normalization proves stable.
- Better Zhihu-class SPA article extraction (e.g. Readability port) if selector/JSON fallbacks still produce thin bodies for hot domains.
- Optional suppression of the Quote banner when Text becomes the only viable mode.

### Actors / Flows

- A1. Chat user opening a URL Preview.
- F1. Open embeddable URL → iframe renders → unchanged.
- F2. Open XFO-blocked URL → iframe fails → panel auto-switches to Text (with notice) using prefetched extract.
- F3. Open blocked URL, extract fails → panel offers Open externally.
- F4. Any successful extract (client or server cleaned) renders without provider chrome.

### Acceptance Examples

- AE1. Preview `zhihu.com` article: user sees Text article (not a broken iframe) after a short beat, with a dismissible “switched to text because this site blocks embedding” notice.
- AE2. Preview an embeddable blog: iframe renders full-height; no auto-switch; Quote banner + Embed/Text toggle unchanged.
- AE3. Extract from Jina keyless no longer starts with `Title:` / `URL Source:` / `Markdown Content:` lines; no `[Image N]` orphan lines.
- AE4. Real article images with valid URLs in keyed-Tavily/Jina markdown still render as images (conservative image rule; do not strip all `![]()`).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Detection heuristic, not header sniffing.** From JS we cannot read X-Frame-Options or reliably get `error` events. Chosen approach (session-settled direction): keep current sandbox (includes `allow-same-origin`), on `load` probe `contentDocument`; treat as blocked when the document is unreadable as a cross-origin error page OR has an about:blank/empty body, and fall back to a settle-timer that requires extract-ready before switching. This keeps false-positive risk on slow sites (mitigation in U1). Alternative considered: HEAD request to sniff headers from Next `/api` — rejected: extra request per preview + sites vary per-path; keep as possible later refinement.
- KTD2. **Auto-switch only when extract is already in hand.** We already prefetch extract while iframe loads. Degrade uses that prefetch; if it is not done, show an intermediate “site may be blocking embed” with retry/open-external rather than firing a second fetch storm or leaving the dead pane.
- KTD3. **One normalizer at the source, thin mirror in client.** chat-api adds `cleanWebReadContent()` applied once in `webRead()` after provider success (and to bare-fetch output), armed with provider-tolerant regexes. Client adds a minimal idempotent `cleanUrlExtractText()` in preview land as defense for old servers. No duplicated nav-cluster logic client-side (server owns heavy cleanup).
- KTD4. **Image policy: keep real images, drop placeholders.** Strip lines that are exactly `[Image N]`/`![Image N]`/`Image N` or `![](…)` with empty/JS/self-src; never strip normal `![alt](https://…)` images. Rationale: Zhihu-class pages flood `Image N` placeholders from Jina; stripping all images would degrade legitimate markdown.
- KTD5. **Keep layout rule from PR #28.** Banner and notice bars are `shrink-0` siblings above a `flex-1 min-h-0` content region; any new notice must reuse that pattern so we never regress to the “top strip only” collapse.
- KTD6. **chat-api changes scoped to `src/services/tools/webRead.js` + new `cleanContent.js` + tests**, deployed as a normal code change (chat-api is plain Node ESM, `npm test` = `node --test`); route/contract (`/v1/tools/web_read` response shape) unchanged.

### Assumptions

- Chrome/Edge (user's browser) fire a `load` event on XFO-blocked iframes whose `contentDocument` is either inaccessible or an empty error document; Safari may differ — the timer+extract gate prevents harm if we can't distinguish.
- chat-api can be edited/tested locally; deployment/release of chat-api is out of band but required for R4/R5 to take effect (noted in Open Questions).
- Current prefetch+extract behavior (≤80k chars) is acceptable; cleaning does not need full-content second pass.

### High-Level Technical Design

```
iframe onLoad ──probe contentDocument──► readable doc? ──yes──► stay in Embed (unchanged)
      │                                        │no
      │                                 mark embedLikelyBlocked
      │                                        │
      ▼                                        ▼
settle timer (~2.5s) ──extract prefetch done?──yes──► setMode('extract') + notice (R1)
      │                                        │still loading
      │                                        ▼
      └──────────────────────────────► show "may be blocked" fallback UI w/ open-external (R3)

Server (chat-api): provider.read() → cleanWebReadContent(raw, {provider}) → truncate → respond
Client (this repo): /api/web-read → cleanUrlExtractText(content) → AnswerMarkdown
```

---

## Implementation Units

### U1. Embed-success probe + blocked state

**Goal:** Distinguish “iframe actually rendered” from “blocked/error document” in `UrlPreviewPanel`, without breaking working embeds.

**Requirements:** R1, R2, KTD1, KTD5.

**Dependencies:** none.

**Files:**
- `components/chat/panels/UrlPreviewPanel.tsx` (modify)
- `tests/chat/url-preview-embed-probe.test.ts` (new; vitest, node env — probe helper is pure)

**Approach:**
1. Extract a tiny pure helper, e.g. `probeEmbedOutcome(iframe): 'ready' | 'likely-blocked'`, in the panel file or `lib/files/url-preview.ts`, so it is testable: try `iframe.contentDocument` / `contentWindow?.document`; treat thrown security error or `document.URL === 'about:blank'`/`about:srcdoc` or empty `<body>` as `likely-blocked`; readable non-empty document → `ready`.
2. In the panel, on iframe `onLoad`, run the probe immediately and once more after ~150ms (error documents settle async). Keep a `embedLikelyBlocked` state; do NOT change mode yet.
3. Drive a settle path: when `embedLikelyBlocked` is true, start a short timer (~2.5s); on fire, if prefetch extract is `done`, `setMode('extract')` + `setEmbedNotice(true)`; else keep iframe pane hidden behind a fallback block (U2) while extract finishes.
4. Ensure probe never throws into React render; guard all DOM access in try/catch inside the helper.
5. Keep the iframe mounted while deciding, so a late-successful load can flip `embedLikelyBlocked` back to false (e.g. about:blank observed mid-load on legitimate sites).

**Patterns to follow:** existing effects pattern in the same file (prefetch effect with AbortController); helper purity like `lib/files/url-preview.ts` normalization helpers.

**Test scenarios:**
- Happy: fake iframe object with readable `contentDocument` (URL `https://…`, body textContent non-empty) → `probeEmbedOutcome` returns `ready`.
- Blocked-by-XFO shape: `contentDocument` getter throws `DOMException` (simulate cross-origin error doc) → returns `likely-blocked`.
- Blank error doc: readable but `URL === 'about:blank'` and empty body → `likely-blocked`.
- In-progress load: readable `about:blank` doc must not crash; helper result feeds the “late success flips back” rule (unit-test the state transition helper if extracted, else document via panel test).
- Non-browser safety: helper accepts `null`/mock and never throws.

**Verification:** `npx vitest run tests/chat/url-preview-embed-probe.test.ts` passes; panel compiles with no TS errors.

---

### U2. Degrade UX + notice + fallback, preserving layout

**Goal:** Convert `embedLikelyBlocked` into good UX: auto-switch to Text with a dismissible notice when extract is ready; otherwise show actionable fallback; never reintroduce the PR #28 top-strip collapse.

**Requirements:** R1, R2, R3, R5 (layout), KTD2, KTD5.

**Dependencies:** U1.

**Files:**
- `components/chat/panels/UrlPreviewPanel.tsx` (modify)
- `lib/i18n/messages.ts` (add keys EN+ZH, e.g. `urlPreviewEmbedBlockedSwitched`, `urlPreviewEmbedBlockedBody`, `urlPreviewOpenExternallyCTA` reuse existing where possible)
- `tests/chat/url-preview-degrade.test.tsx` or extend probe test with pure decision helper (new or modify; keep node-friendly by extracting a `decideDegradeAction({blocked, prefetchStatus})` pure function)
- `lib/chat/README.md` (one-line matrix row update if it mentions modes)

**Approach:**
1. Add pure `decideDegradeAction({ embedLikelyBlocked, prefetch }: ...): 'auto-extract' | 'fallback' | 'wait'` for testable transitions; wire states into effects.
2. On `auto-extract`: `setMode('extract')`, show a slim amber notice (`shrink-0`) under the URL bar: “This site blocks embedding — showing extracted text.” with a dismiss ×. Reuse the banner pattern from the Quote `urlPreviewQuoteNeedsExtract` bar (sibling above the `flex-1` content container). Suppress the Quote-needs-extract banner while in extract mode (already only renders in iframe mode).
3. On `fallback` (blocked + extract error or extract still loading past a patience bound): render centered block in the content area: Globe icon + short body + primary “Open externally” + secondary “try again” (re-fires extract fetch) — replacing the gray iframe so users are never handed a dead pane.
4. Keep iFrame→Text toggle segmented control working: if user manually switches back to Embed while blocked, honor it (clear notice; no loop). Manual switch clears the settle timer.
5. New i18n strings added for both locales, mirroring nearby key style.

**Patterns to follow:** PR #28 banner/content layout contract (`shrink-0` bars + `flex-1 min-h-0` region); existing auth-mode fallback block styling.

**Test scenarios:**
- Happy: blocked + prefetch done → `decideDegradeAction` → `auto-extract`.
- Blocked + prefetch loading → `wait`; after a timeout with still-loading → `fallback` (encode timeout as injected constant for testability).
- Blocked + prefetch error → `fallback`.
- Not blocked → `wait` (never auto-switches), timer cleared on manual mode change (unit-test the decision fn; effect-level wiring verified by code review).
- i18n: both locales contain the new keys (simple existence test or rely on existing locale-parity check if repo has one).

**Verification:** vitest suite for the decision helper passes; manual smoke (dev server) on `zhihu.com` article shows auto Text + notice, and on an embeddable site shows unchanged iframe.

---

### U3. Client-side extract cleaning (belt)

**Goal:** Thin, conservative client cleaning of extract text for URL Preview so even stale chat-api responses render without Jina chrome.

**Requirements:** R6, R4 patterns parity, KTD3, KTD4.

**Dependencies:** none (independent of U2; applied at extract render path).

**Files:**
- `lib/files/url-extract-clean.ts` (new; pure functions)
- `components/chat/panels/UrlPreviewPanel.tsx` (apply to `extract.content` before `AnswerMarkdown`, memoized)
- `tests/chat/url-extract-clean.test.ts` (new)

**Approach:**
1. `cleanUrlExtractText(raw: string): string` — pure; steps, all line-local only:
   - Strip a leading provider header block: consecutive top-of-document lines matching `^(Title|URL Source|Markdown Content):\s` (Jina keyless shape); also drop duplicated standalone title line if it exactly equals provided `title` (pass title in as optional arg).
   - Drop image-placeholder lines: `/^\s*\[?Image\s*\d+\]?!?\s*$/i` and `!\[Image\s*\d*\]\([^)]*\)`; drop `![](…)` where src is empty, `#`, or `javascript:`.
   - Collapse 3+ blank lines to 2; trim.
2. MUST NOT touch: markdown headings, lists, links, code fences, tables, or images with http(s) srcs.
3. Apply once in the panel (e.g. `useMemo` on extract.content); do not mutate stored extract (Quote path reads raw text from DOM after render, so rendered text must match what the user sees → cleaning before render is the correct layer).

**Patterns to follow:** pure-text utils in `lib/markdown/**` and `lib/files/url-preview.ts`.

**Test scenarios:**
- Happy: `Title: X\nURL Source: …\nMarkdown Content:\n\nReal body` → body only.
- Only header lines stripped at doc start; a `Title:` line mid-body is preserved.
- `[Image 1]` / `![Image 2](https://x/y.png)` → first dropped, second kept.
- `![]()` / `#`-src image lines dropped; normal image kept.
- Idempotent: `clean(clean(x)) === clean(x)`.
- Empty/whitespace input → `''`.

**Verification:** `npx vitest run tests/chat/url-extract-clean.test.ts` passes.

---

### U4. chat-api server-side normalization

**Goal:** Normalize every successful `web_read` provider body at the source: strip wrapper headers, boilerplate, placeholder image lines, and nav link clusters.

**Target repo:** `chat-api` (paths below relative to `chat-api/`).

**Requirements:** R4, R5, R7, KTD3, KTD4.

**Dependencies:** none upstream (works with existing providers); pairs with U3 so client stays a slim mirror.

**Files:**
- `src/services/tools/cleanContent.js` (new — pure cleaners: `cleanWebReadContent(body, { provider, title } )`)
- `src/services/tools/webRead.js` (wire cleaner into each provider success path before `truncateContent`, or once centrally in `webRead()` before return — prefer central single call so bare-fetch is covered too)
- `test/clean-content.test.js` (new; repo uses `node --test` — match existing test style)

**Approach:**
1. `cleanWebReadContent(content, {provider, title})`:
   - Strip Jina keyless header block at doc start: `Title:`, `URL Source:`, `Markdown Content:` (and `Warning:`/`Note:` Jina banner lines when present at top).
   - Remove provider boilerplate lines known from Zhipu/Tavily shapes (only strict, line-local patterns — e.g. leading `---` fences wrapping the whole doc from Jina plain mode may be unwrapped if trivially detectable; otherwise leave).
   - Image policy per KTD4: drop `[Image N]`/`![Image N](…)` placeholder lines and empty/`javascript:` src images; keep real images.
   - Nav link-cluster collapse: within a run of ≥4 consecutive lines that are each single markdown links or bare anchor-like lines with ≤6 words, drop the run (nav chrome), but never inside code fences and never mid-list of links that forms real content (guard: require preceding+following blank line, cap removal to runs at top-of-body or separated blocks).
   - Collapse excessive blank lines; preserve internal structure otherwise.
2. Wire centrally in `webRead()` success path: `content = cleanWebReadContent(raw, ctx)` before `truncateContent`; keep `MIN_EXTRACT_CHARS` check AFTER cleaning (cleaning may shrink bodies).
3. Keep response contract identical (`provider`, `url`, `title`, `description`, `content`, `error`).

**Patterns to follow:** existing utils in `src/services/tools/` (`url.js`, `types.js` export style); node:test files already in repo (inspect one before writing).

**Test scenarios:**
- Jina keyless sample (paste a real captured header block) → stripped; body preserved verbatim afterwards.
- Zhipu markdown body unchanged when no wrappers present (no-op on clean input).
- Image placeholder removal vs real image retention (mirrors U3 expectations, server-side).
- Nav cluster: 5-line link-run removed; 2-pair author/twitter links mid-article with prose between kept.
- Code fence containing `[Image 1]` text is NOT touched.
- Cleaned output still ≥ `MIN_EXTRACT_CHARS` for normal articles; over-aggressive cleaning on tiny bodies doesn't crash (returns short body, provider chain's existing empty-check handles).

**Verification:** `npm test` (node --test) green in chat-api; a manual `node -e` harness reading a captured Zhihu Jina response shows cleaned output.

---

### U5. Docs + ship

**Goal:** Record behavior changes; land both repos' changes as separate PRs.

**Requirements:** all above; user prefers fast merge to main.

**Dependencies:** U1–U4.

**Files:**
- `lib/chat/README.md` (URL Preview row: mention blocked-embed degrade + extract cleaning)
- `docs/plans/2026-08-06-006-fix-url-preview-embed-detect-extract-clean-plan.md` (this file — mark executed sections as needed)
- chat-api: its README or changelog only if one exists for tools (check first; do not create new docs files there)

**Approach:**
1. This repo: branch `fix/url-preview-embed-degrade` → implement U1–U3 (+U5 docs) → vitest → PR → merge to main.
2. chat-api: branch off its default → U4 → `npm test` → PR/merge per its repo norms (no CD changes here).
3. Report both PR links to user; note deployment of chat-api needed for R4/R5 to be live.

**Test scenarios:** none — docs/release unit. (`Test expectation: none — release bookkeeping.`)

**Verification:** both PRs merged; user confirms Zhihu preview now lands on cleaned Text automatically.

---

## Verification Contract

- This repo: `npx vitest run tests/chat/url-preview-embed-probe.test.ts tests/chat/url-extract-clean.test.ts` (plus full `npx vitest run` pre-merge); `npx tsc` clean via existing lint/type gate (follow repo's current check command used in CI).
- chat-api: `npm test` under `chat-api/` (node --test).
- Manual smoke (dev server): (a) Zhihu URL → auto Text + notice, no dead iframe; (b) embeddable blog → unchanged full-bleed iframe; (c) auth-gated host (e.g. Notion) → unchanged auth gate; (d) Text-mode extract of a Jina-heavy page shows no `Markdown Content:` header, no `[Image N]` lines, real images intact; (e) Quote in Text mode still attaches url/title.

## Definition of Done

- [ ] U1 probe helper + tests merged.
- [ ] U2 degrade UX + notice + fallback merged; layout rule from PR #28 holds (banner siblings `shrink-0`, content `flex-1 min-h-0`).
- [ ] U3 client cleaner + tests merged.
- [ ] U4 chat-api cleaner + tests merged; response contract unchanged.
- [ ] U5 docs updated; both PRs merged to main / chat-api default branch; user informed of chat-api deploy need.
- [ ] No regression: working embeds, auth gate, Quote extract metadata, EPUB/PDF quote behavior unchanged.

---

## Open Questions

- (Non-blocking) **chat-api release:** who deploys chat-api after merge? Server-side cleaning only takes effect then. Client cleaner (U3) covers the gap meanwhile.
- (Non-blocking) Probe tuning: settle-timer length (start 2.5s) and the extra ~150ms re-probe may need real-device tuning on slow sites; constants should be easy to find in one place.

## Deferred to Implementation

- Exact regex set for nav-cluster collapse (tune on real captured bodies during implementation).
- Whether to include `provider` name in `/api/web-read` response pass-through for future per-provider polish (currently the route passes upstream JSON through; harmless to leave as-is).
