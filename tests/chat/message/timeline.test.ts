import { describe, expect, it } from 'vitest';
import { findLastContentSegmentId, type TimelineSegment } from '@/lib/chat/message/timeline';

describe('findLastContentSegmentId', () => {
  it('returns undefined when there are no content segments', () => {
    const segs: TimelineSegment[] = [
      { type: 'process', id: 'p1', steps: [], live: false },
      { type: 'file', id: 'f1', fileId: 'file-1' },
    ];
    expect(findLastContentSegmentId(segs)).toBeUndefined();
  });

  it('returns the id of the last content segment among mixed segments', () => {
    const segs: TimelineSegment[] = [
      { type: 'content', id: 'c1', text: 'first' },
      { type: 'process', id: 'p1', steps: [], live: false },
      { type: 'content', id: 'c2', text: 'second' },
      { type: 'file', id: 'f1', fileId: 'file-1' },
    ];
    expect(findLastContentSegmentId(segs)).toBe('c2');
  });

  it('returns the only content segment when it is not last', () => {
    const segs: TimelineSegment[] = [
      { type: 'content', id: 'c1', text: 'only' },
      { type: 'file', id: 'f1', fileId: 'file-1' },
    ];
    expect(findLastContentSegmentId(segs)).toBe('c1');
  });
});
