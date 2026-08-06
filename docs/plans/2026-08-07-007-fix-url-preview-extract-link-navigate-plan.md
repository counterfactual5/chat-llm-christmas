---
title: "fix: URL Preview extract links navigate in-panel"
date: 2026-08-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: fix
---

# fix: URL Preview extract links navigate in-panel

## Goal Capsule

In URL Preview **Text (extract)** mode, clicking an http(s) link (including paths resolved against the current page URL) must navigate the side panel via the existing `onNavigateUrl` path — not open the system browser — unless the user uses a modifier / middle-click.

**Stop when:** extract-mode link clicks stay in-panel; modifier/middle-click still opens a tab; relative hrefs resolve against the current preview URL; unit tests cover the resolver; cross-origin iframe click interception remains out of scope and unchanged.

**Authority:** session-settled — user confirmed scope option **1** (extract in-panel nav + relative resolution; iframe intercept deferred; auth-gated policy and default Text mode unchanged).

---

## Product Contract

### Summary

Chat markdown already intercepts previewable links via `AnswerMarkdown` + `onPreviewLink`. URL Preview extract reuses `AnswerMarkdown` but omits that callback, so links fall through to `target="_blank"`. Wire the same intercept, resolve relative hrefs against the open preview URL, and keep external-open escapes identical to chat.

### Problem Frame

Default preview mode is extract (`initialPreviewMode` → `'extract'`). Extract body renders:

```tsx
<AnswerMarkdown text={cleanedExtractContent} streaming={false} />
```

Without `onPreviewLink`, every link uses `target="_blank"`. Address-bar `onNavigateUrl` already works (`chat-container` → `openUrlPreview`). Relative markdown hrefs (`/path`, `./x`) also fail `isPreviewableHttpUrl` today, so even a naive callback would miss them and let the browser navigate the SPA origin.

Cross-origin **iframe** clicks cannot be intercepted by the parent (same constraint as Quote plan KTD1 in `docs/plans/2026-08-06-005-feat-quote-iframe-bridge-plan.md`). Users who want in-panel hops from embedded pages use the address bar or switch to Text.

### Requirements

- R1. In URL Preview extract mode, a plain left-click on a previewable web link navigates the panel (same target state as address-bar submit / `openUrlPreview`), without opening a new browser tab.
- R2. Cmd/Ctrl/Shift/Alt-click and middle-click still open externally (`shouldOpenLinkExternally`), matching chat.
- R3. Relative and root-relative hrefs in extract markdown resolve against the **current** panel `url` before navigation; unresolvable / non-http(s) hrefs keep default browser behavior (or no in-panel nav).
- R4. When `onNavigateUrl` is absent, extract links behave as today (external `target="_blank"`) — no broken intercept.
- R5. Auth-gated hosts, default Text mode, iframe sandbox, and open-externally CTA buttons are unchanged by this fix.
- R6. No new runtime dependencies.

### Scope Boundaries

**In scope:** `UrlPreviewPanel` extract → `AnswerMarkdown` wiring; shared href resolve helper in `lib/files/url-preview.ts`; small `AnswerMarkdown` API to honor a preview base URL for resolution + preventDefault; unit tests in `tests/files/url-preview.test.ts`; README one-liner if preview click behavior is documented.

**Out of scope:** Intercepting clicks inside cross-origin iframes; proxy / cookie jar; changing `AUTH_GATED_PREVIEW_HOST_SUFFIXES`; forcing iframe as default mode; Reference / chat-bubble link behavior (already correct).

### Deferred to Follow-Up Work

- Same-origin iframe link rewriting / postMessage navigation bridge (if a controllable embed ever needs it).
- Syncing iframe `src` history into the address bar on in-frame navigations (browser-limited for cross-origin).

### Actors / Flows

- A1. Chat user reading URL Preview Text body.
- F1. Click absolute `https://…` link in extract → panel loads that URL (extract reset / mode rules as today on `url` change).
- F2. Click `/wiki/Foo` while previewing `https://en.wikipedia.org/wiki/Bar` → panel navigates to `https://en.wikipedia.org/wiki/Foo`.
- F3. Cmd-click any link → new tab; panel URL unchanged.
- F4. User in iframe mode clicks an in-page link → unchanged (frame or browser popups per site); not claimed as in-panel nav.

### Acceptance Examples

- AE1. Open a non-auth URL in Preview (Text). Click an absolute outbound link in the extract → side panel address updates and extract reloads for the new URL; no new OS browser window/tab from that click.
- AE2. Extract contains a root-relative link; click navigates in-panel to the resolved absolute URL on the same host as the current preview.
- AE3. Cmd-click (or Ctrl-click) the same link → new tab; panel stays on the previous URL.
- AE4. With Preview open in iframe mode on a cross-origin site, in-frame link clicks are not required to update the panel chrome (deferred); Text mode still satisfies AE1–AE3.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Reuse `onNavigateUrl` / `openUrlPreview` as the single navigation sink — do not invent a second preview state path. Rationale: address bar already commits through this; keeps history/title reset behavior one place (`UrlPreviewPanel` `useEffect` on `url`).
- KTD2. Add `resolvePreviewHttpUrl(href, baseUrl?)` (name flexible) in `lib/files/url-preview.ts` that: trims; rejects file-proxy / `local:` / `data:` / non-http schemes after resolution; if `href` is relative and `baseUrl` is absolute http(s), uses `new URL(href, baseUrl)`; then returns normalized absolute href or `''`. Rationale: keeps resolution testable and shared; address-bar paste can keep using `normalizePreviewHttpUrl` (bare hosts) without changing paste semantics.
- KTD3. Extend `AnswerMarkdown` with optional `previewBaseUrl?: string`. Click path: resolve via KTD2 helper → if resolved and `onPreviewLink` set and not external modifiers → `preventDefault` + `onPreviewLink(resolved)`. Rationale: relative hrefs never reach the callback today because `isPreviewableHttpUrl` fails first; resolution must happen **before** the gate. Chat callers omit `previewBaseUrl` (behavior unchanged for absolute links).
- KTD4. `UrlPreviewPanel` passes `onPreviewLink={onNavigateUrl}` (or a thin wrapper) and `previewBaseUrl={url}` only when `onNavigateUrl` is defined. Rationale: matches R4; avoids intercepting when empty paste chrome has no nav sink.
- KTD5. Do not attempt iframe click interception. Document in README if needed. Rationale: settled scope + prior Quote/iframe plans.

### Assumptions

- Extract markdown hrefs are either absolute http(s) or resolvable against the page URL the extract was fetched for (same `url` prop).
- `openUrlPreview` already no-ops on empty normalize results — callers may pass only resolved strings.
- Existing chat `onPreviewLink={onPreviewUrl}` remains absolute-only in practice; optional base does not regress it.

### External Research Confidence

No load-bearing external research. Grounded in in-repo wiring (`UrlPreviewPanel`, `AnswerMarkdown`, `url-preview.ts`) and prior plans `2026-08-06-005` / `2026-08-06-006`.

### Alternatives Considered

| Alternative | Why not |
|---|---|
| Only pass `onPreviewLink` without base resolution | Leaves relative links opening against the app origin / blank tab. |
| Rewrite all extract links to absolute on the server | Heavier; client already has the base URL; cleaning layer is for chrome noise not link policy. |
| Proxy iframe + rewrite anchors | Explicitly out of scope; security/compliance cost. |

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Resolving odd relative hrefs (`?q=1`, `#hash`, `//cdn…`) incorrectly | Unit-test protocol-relative and query/hash cases; reject non-http(s) after `URL` parse. |
| Chat markdown accidentally gets a base URL | Only Preview passes `previewBaseUrl`; chat omits it. |
| Double-normalize churn on already-absolute URLs | Helper should be idempotent for absolute http(s). |

### Open Questions

None blocking. Deferred iframe address-bar sync is explicitly out of scope.

### Implementation Units (overview)

U1 resolver + tests → U2 `AnswerMarkdown` click gate → U3 `UrlPreviewPanel` wiring (+ README if needed). No parallelizable split required; serial is fine.

---

## Implementation Units

### U1. Preview href resolver

**Goal:** Pure helper that turns markdown `href` + optional base into a previewable absolute http(s) URL or `''`.

**Requirements:** R3, R6

**Files:**
- Modify: `lib/files/url-preview.ts`
- Test: `tests/files/url-preview.test.ts`

**Approach:**
- Implement `resolvePreviewHttpUrl(href, baseUrl?)` beside `normalizePreviewHttpUrl`.
- Absolute http(s) → normalize (reuse existing normalize where possible).
- Relative / path-only → require valid http(s) `baseUrl`, then `new URL(href, base)`.
- Protocol-relative (`//example.com/x`) → resolve with base or default `https:`.
- Reject `/api/files/…`, `mailto:`, `javascript:`, empty, invalid.

**Test scenarios:**
- Happy: `resolvePreviewHttpUrl('https://a.com/b')` → absolute normalized.
- Happy: `resolvePreviewHttpUrl('/wiki/Foo', 'https://en.wikipedia.org/wiki/Bar')` → `https://en.wikipedia.org/wiki/Foo`.
- Happy: `resolvePreviewHttpUrl('../x', 'https://example.com/a/b/')` → expected absolute.
- Edge: no base + relative → `''`.
- Edge: `mailto:` / `/api/files/x` → `''`.
- Edge: idempotent on already-normalized absolute URLs.
- Integration: N/A (pure unit).

**Verification:**
- `npx vitest run tests/files/url-preview.test.ts`

---

### U2. AnswerMarkdown preview base + click gate

**Goal:** Optional `previewBaseUrl` so relative extract links can preventDefault and invoke `onPreviewLink` with a resolved absolute URL.

**Requirements:** R1, R2, R3, R4

**Files:**
- Modify: `components/chat/message/AnswerMarkdown.tsx`
- Test: covered primarily via U1; optional light component test only if the repo already patterns markdown click tests (do not invent a heavy RTL harness solely for this).

**Approach:**
- Add optional `previewBaseUrl?: string`.
- In `a` renderer onClick: `const resolved = resolvePreviewHttpUrl(link, previewBaseUrl)`; if `!onPreviewLink || !resolved` return; if `shouldOpenLinkExternally(e)` return; else preventDefault + `onPreviewLink(resolved)`.
- Keep `target="_blank"` as progressive enhancement for external / no-callback cases.
- Do not change slash-command or other renderers.

**Test scenarios:**
- Happy: with `onPreviewLink` + absolute href → callback gets absolute (manual / existing pattern).
- Edge: without `onPreviewLink`, relative click does not throw (default navigation).
- Edge: modifier click does not call `onPreviewLink` (logic shared with existing helper tests).

**Verification:**
- Typecheck / existing chat preview still compiles; spot-check in browser under U3.

---

### U3. UrlPreviewPanel extract wiring

**Goal:** Extract body uses the same in-panel navigation sink as the address bar.

**Requirements:** R1–R5

**Files:**
- Modify: `components/chat/panels/UrlPreviewPanel.tsx`
- Modify (optional): `lib/files/README.md` — one sentence under URL preview click behavior if that section exists / is the natural home.

**Approach:**
- On extract `AnswerMarkdown`, when `onNavigateUrl` is defined: pass `onPreviewLink={onNavigateUrl}` and `previewBaseUrl={url}`.
- When absent: omit both (empty paste / read-only chrome).
- No mode switch forced on link navigate; rely on existing `url` effect to reset extract/iframe state.
- Leave iframe branch untouched.

**Test scenarios:**
- Happy: AE1 / AE2 manual — click extract link updates panel URL.
- Edge: AE3 modifier still external.
- Edge: AE4 iframe unchanged.
- Integration: address-bar navigate and extract-link navigate produce the same `previewTarget` shape via `openUrlPreview`.

**Verification:**
- Manual: open Preview Text on a page with outbound + relative links; confirm AE1–AE3.
- `npx vitest run tests/files/url-preview.test.ts`

---

## Verification Contract

**Automated:**
- `npx vitest run tests/files/url-preview.test.ts`

**Manual:**
- AE1–AE3 on a public article extract (e.g. Wikipedia).
- Confirm auth-gated Notion/GitHub still show auth CTA, not broken by wiring.
- Confirm chat bubble links still open Preview (regression).

**Quality gates:**
- No new dependencies.
- No change to iframe sandbox or auth-gated suffix list.

---

## Definition of Done

- [ ] U1 helper + unit tests green
- [ ] U2 `AnswerMarkdown` resolves with optional base before gate
- [ ] U3 extract passes `onPreviewLink` + `previewBaseUrl` when `onNavigateUrl` set
- [ ] AE1–AE3 satisfied; AE4 explicitly not claimed
- [ ] README touched only if preview click behavior is already documented there
- [ ] Out-of-scope iframe intercept not implemented

---

## Appendix

### Code anchors

- Missing wiring: `components/chat/panels/UrlPreviewPanel.tsx` (extract `AnswerMarkdown` ~531–534)
- Working chat pattern: `components/chat/message/ChatMessageList.tsx` (`onPreviewLink={onPreviewUrl}`)
- Helpers: `lib/files/url-preview.ts` (`isPreviewableHttpUrl`, `normalizePreviewHttpUrl`, `shouldOpenLinkExternally`)
- Nav sink: `components/chat-container.tsx` (`openUrlPreview`, `onNavigateUrl`)

### Related plans

- `docs/plans/2026-08-06-005-feat-quote-iframe-bridge-plan.md` — cross-origin iframe limits
- `docs/plans/2026-08-06-006-fix-url-preview-embed-detect-extract-clean-plan.md` — extract default / embed degrade
