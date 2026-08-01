import { describe, expect, it } from 'vitest';
import {
  afterRemoveTask,
  pauseSession,
  removeTaskById,
  selectTasksToDrain,
  type QueuedTask,
} from '@/lib/chat/task-queue';
import {
  gateResumeIncompleteReply,
  markdownTableSeamPrefix,
  pickResumeBranch,
} from '@/lib/chat/continuation';
import type { Message } from '@/lib/chat/types';

function task(id: string, sessionId: string): QueuedTask {
  return { id, sessionId, content: id, enqueueTime: 1 };
}

describe('task-queue', () => {
  it('drains one idle task per session and skips loading/paused', () => {
    const queue = [
      task('a1', 's1'),
      task('a2', 's1'),
      task('b1', 's2'),
      task('c1', 's3'),
    ];
    const picked = selectTasksToDrain(
      queue,
      { s2: true },
      { s3: true },
    );
    expect(picked.map((t) => t.id)).toEqual(['a1']);
  });

  it('clears pause when the last task for a session is removed', () => {
    const queue = [task('a1', 's1'), task('b1', 's2')];
    const next = removeTaskById(queue, 'a1');
    const paused = afterRemoveTask(next, task('a1', 's1'), pauseSession({}, 's1'));
    expect(paused.s1).toBeUndefined();
    expect(pauseSession({}, 's2').s2).toBe(true);
  });
});

describe('continuation', () => {
  const assistant = (partial: Partial<Message>): Message => ({
    id: 'a',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...partial,
  });

  it('gates incomplete empty replies and blocks complete ones', () => {
    expect(
      gateResumeIncompleteReply(
        assistant({ incomplete: true, content: '' }),
      ).ok,
    ).toBe(true);
    expect(
      gateResumeIncompleteReply(
        assistant({ content: 'Done.\n\nThat is all.' }),
      ).ok,
    ).toBe(false);
  });

  it('picks reanswer vs answer_after_process vs continue', () => {
    const user: Message = {
      id: 'u',
      role: 'user',
      content: 'hi',
      timestamp: 1,
    };
    expect(
      pickResumeBranch(assistant({ incomplete: true, content: '' }), user, true),
    ).toBe('reanswer_empty');
    expect(
      pickResumeBranch(
        assistant({ incomplete: true, content: '', reasoning: 'thinking' }),
        user,
        true,
      ),
    ).toBe('answer_after_process');
    expect(
      pickResumeBranch(assistant({ content: 'partial table |' }), user, false),
    ).toBe('continue');
  });

  it('adds a newline seam after a markdown table row', () => {
    expect(markdownTableSeamPrefix('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('\n');
    expect(markdownTableSeamPrefix('plain paragraph')).toBe('');
  });
});
