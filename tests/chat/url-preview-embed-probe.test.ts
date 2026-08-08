import { describe, expect, it } from 'vitest';
import {
  decideDegradeAction,
  probeEmbedOutcome,
  type EmbedProbeIframeLike,
} from '@/lib/files/url-preview-embed';

function iframeWithDoc(doc: {
  URL?: string;
  bodyText?: string | null;
  bodyHtml?: string;
}): EmbedProbeIframeLike {
  return {
    contentDocument: {
      URL: doc.URL,
      body: { textContent: doc.bodyText, innerHTML: doc.bodyHtml ?? '' },
    },
  };
}

describe('probeEmbedOutcome', () => {
  it('ready: readable document with real URL and body text', () => {
    const iframe = iframeWithDoc({
      URL: 'https://example.com/post',
      bodyText: 'hello world',
      bodyHtml: '<p>hello world</p>',
    });
    expect(probeEmbedOutcome(iframe)).toBe('ready');
  });

  it('unknown: contentDocument access throws (successful cross-origin embed)', () => {
    // A cross-origin page that embedded successfully also throws here — must
    // NOT be treated as blocked.
    const iframe: EmbedProbeIframeLike = {};
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new DOMException('Blocked a frame', 'SecurityError');
      },
    });
    expect(probeEmbedOutcome(iframe)).toBe('unknown');
  });

  it('likely-blocked: about:blank document with empty body', () => {
    const iframe = iframeWithDoc({ URL: 'about:blank', bodyText: '' });
    expect(probeEmbedOutcome(iframe)).toBe('likely-blocked');
  });

  it('likely-blocked: about:srcdoc document with empty body', () => {
    const iframe = iframeWithDoc({ URL: 'about:srcdoc', bodyText: ' ' });
    expect(probeEmbedOutcome(iframe)).toBe('likely-blocked');
  });

  it('likely-blocked: real URL but empty body (error document shell)', () => {
    const iframe = iframeWithDoc({
      URL: 'https://example.com/post',
      bodyText: '',
      bodyHtml: '',
    });
    expect(probeEmbedOutcome(iframe)).toBe('likely-blocked');
  });

  it('ready: real URL with markup but no text (e.g. canvas app)', () => {
    const iframe = iframeWithDoc({
      URL: 'https://example.com/app',
      bodyText: '',
      bodyHtml: '<canvas></canvas>',
    });
    expect(probeEmbedOutcome(iframe)).toBe('ready');
  });

  it('unknown: no document available yet', () => {
    expect(probeEmbedOutcome({})).toBe('unknown');
    expect(probeEmbedOutcome({ contentDocument: null })).toBe('unknown');
  });

  it('never throws on null/garbage input', () => {
    expect(probeEmbedOutcome(null)).toBe('unknown');
    expect(probeEmbedOutcome(undefined)).toBe('unknown');
    expect(
      probeEmbedOutcome({ contentWindow: { document: undefined } }),
    ).toBe('unknown');
  });

  it('supports contentWindow.document fallback', () => {
    const iframe: EmbedProbeIframeLike = {
      contentWindow: {
        document: {
          URL: 'https://example.com',
          body: { textContent: 'hi', innerHTML: '<p>hi</p>' },
        },
      },
    };
    expect(probeEmbedOutcome(iframe)).toBe('ready');
  });
});

describe('decideDegradeAction', () => {
  it('auto-extract: blocked + prefetch done', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'done',
        settleFired: false,
      }),
    ).toBe('auto-extract');
  });

  it('wait: blocked + prefetch loading before settle', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'loading',
        settleFired: false,
      }),
    ).toBe('wait');
  });

  it('fallback: blocked + prefetch still loading after settle', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'loading',
        settleFired: true,
      }),
    ).toBe('fallback');
  });

  it('fallback: blocked + prefetch error (immediately)', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'error',
        settleFired: false,
      }),
    ).toBe('fallback');
  });

  it('fallback: blocked + prefetch no-oa (immediately)', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'no-oa',
        settleFired: false,
      }),
    ).toBe('fallback');
  });

  it('fallback: blocked + prefetch idle after settle', () => {
    expect(
      decideDegradeAction({
        embedLikelyBlocked: true,
        prefetch: 'idle',
        settleFired: true,
      }),
    ).toBe('fallback');
  });

  it('wait: not blocked never auto-switches', () => {
    for (const prefetch of ['idle', 'loading', 'done', 'error'] as const) {
      for (const settleFired of [false, true]) {
        expect(
          decideDegradeAction({ embedLikelyBlocked: false, prefetch, settleFired }),
        ).toBe('wait');
      }
    }
  });
});
