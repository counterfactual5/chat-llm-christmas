import type { Message, MessageActivityStep, MessageToolRun } from '@/lib/chat/types';

export type ActivityStep = MessageActivityStep;
export type ToolStep = Extract<ActivityStep, { kind: 'tool' }>;
export type ProcessStep = Extract<ActivityStep, { kind: 'reasoning' } | { kind: 'tool' }>;

export type TimelineSegment =
  | { type: 'process'; id: string; steps: ProcessStep[]; live: boolean }
  | { type: 'content'; id: string; text: string }
  | { type: 'file'; id: string; fileId: string };

function isCreateFileRun(run: MessageToolRun | undefined): boolean {
  return Boolean(run && (run.name === 'create_file' || run.name === 'create-file'));
}

/**
 * Prefer live activity timeline; fall back for older saved messages.
 * Orphan generated files are placed after the create_file batch.
 */
export function buildActivitySteps(
  message: Message,
  visibleReasoning: string,
  toolById: Map<string, MessageToolRun>,
): ActivityStep[] {
  const base: ActivityStep[] =
    message.activity && message.activity.length > 0
      ? [...message.activity]
      : [
          ...(visibleReasoning
            ? [
                {
                  id: `${message.id}-reasoning`,
                  kind: 'reasoning' as const,
                  text: visibleReasoning,
                },
              ]
            : []),
          ...(message.toolRuns || []).map((run) => ({
            id: `${message.id}-tool-${run.id}`,
            kind: 'tool' as const,
            toolRunId: run.id,
          })),
        ];

  const seen = new Set(
    base
      .filter((s): s is ToolStep => s.kind === 'tool')
      .map((s) => s.toolRunId),
  );
  for (const run of message.toolRuns || []) {
    if (!seen.has(run.id)) {
      base.push({
        id: `${message.id}-tool-orphan-${run.id}`,
        kind: 'tool',
        toolRunId: run.id,
      });
    }
  }

  // Place orphan generated files after the create_file batch
  // (last matching tool), so Process rows stay grouped.
  const fileIdsInActivity = new Set(
    base
      .filter((s): s is { id: string; kind: 'file'; fileId: string } => s.kind === 'file')
      .map((s) => s.fileId),
  );
  const orphanFiles: Array<{ id: string; kind: 'file'; fileId: string }> = [];
  let insertAfter = -1;
  for (const file of message.files || []) {
    if (fileIdsInActivity.has(file.id)) continue;
    orphanFiles.push({
      id: `${message.id}-file-${file.id}`,
      kind: 'file',
      fileId: file.id,
    });
    fileIdsInActivity.add(file.id);
    for (let i = 0; i < base.length; i++) {
      const s = base[i];
      if (s.kind !== 'tool') continue;
      const run = toolById.get(s.toolRunId);
      if (
        isCreateFileRun(run) &&
        (run!.query === file.name || run!.results?.[0]?.title === file.name)
      ) {
        if (i > insertAfter) insertAfter = i;
        break;
      }
    }
  }
  if (orphanFiles.length) {
    // If several create_file tools are consecutive, land after the
    // whole run so file cards don't split the Process panel.
    let spliceAt = insertAfter >= 0 ? insertAfter + 1 : base.length;
    if (insertAfter >= 0) {
      while (spliceAt < base.length && base[spliceAt].kind === 'tool') {
        const run = toolById.get((base[spliceAt] as ToolStep).toolRunId);
        if (!isCreateFileRun(run)) break;
        spliceAt += 1;
      }
    }
    base.splice(spliceAt, 0, ...orphanFiles);
  }
  return base;
}

/**
 * Group consecutive reasoning/tool steps into Process panels.
 * Content breaks the group. Generated files are deferred so a
 * batch of create_file tools stays in one Process, then all
 * file cards render together underneath.
 */
export function buildTimelineSegments(opts: {
  messageId: string;
  activitySteps: ActivityStep[];
  toolById: Map<string, MessageToolRun>;
  visibleContent: string;
  messageIsStreaming: boolean;
  awaitingFirstContent: boolean;
  replyWait: boolean;
}): TimelineSegment[] {
  const {
    messageId,
    activitySteps,
    toolById,
    visibleContent,
    messageIsStreaming,
    awaitingFirstContent,
    replyWait,
  } = opts;

  const hasContentSteps = activitySteps.some((s) => s.kind === 'content');
  const hasFileSteps = activitySteps.some((s) => s.kind === 'file');

  if (!hasContentSteps && !hasFileSteps) {
    const processSteps = activitySteps.filter(
      (s): s is ProcessStep => s.kind === 'reasoning' || s.kind === 'tool',
    );
    const segs: TimelineSegment[] = [];
    if (awaitingFirstContent || processSteps.length > 0 || replyWait) {
      segs.push({
        type: 'process',
        id: `${messageId}-process-0`,
        steps: processSteps,
        live: awaitingFirstContent || replyWait,
      });
    }
    if (visibleContent.trim()) {
      segs.push({
        type: 'content',
        id: `${messageId}-content-legacy`,
        text: visibleContent,
      });
    }
    return segs;
  }

  const segs: TimelineSegment[] = [];
  let buf: ProcessStep[] = [];
  let fileBuf: Array<{ id: string; fileId: string }> = [];
  let processIdx = 0;
  const flushFiles = () => {
    for (const f of fileBuf) {
      segs.push({ type: 'file', id: f.id, fileId: f.fileId });
    }
    fileBuf = [];
  };
  const flushProcess = (live: boolean) => {
    if (!buf.length && !live) return;
    segs.push({
      type: 'process',
      id: `${messageId}-process-${processIdx++}`,
      steps: buf,
      live,
    });
    buf = [];
    // File cards follow the Process block they were interleaved with.
    flushFiles();
  };

  for (const step of activitySteps) {
    if (step.kind === 'content') {
      flushProcess(false);
      // Orphan files with no surrounding process still need to emit.
      flushFiles();
      if (step.text.trim()) {
        segs.push({ type: 'content', id: step.id, text: step.text });
      }
    } else if (step.kind === 'file') {
      // Don't break Process — keep create_file rows in one panel.
      fileBuf.push({ id: step.id, fileId: step.fileId });
    } else {
      // Thought / other tools after a file batch: close the create_file
      // Process + file cards first, then start a fresh Process.
      if (fileBuf.length > 0) {
        const isCreateFileTool =
          step.kind === 'tool' && isCreateFileRun(toolById.get(step.toolRunId));
        if (!isCreateFileTool) {
          flushProcess(false);
          flushFiles();
        }
      }
      buf.push(step);
    }
  }

  // Trailing Process: in-flight tools/thought, or idle gap waiting
  // for the next token after narration ("正在写入……" → tool).
  flushProcess(
    Boolean(messageIsStreaming && (buf.length > 0 || !visibleContent || replyWait)),
  );
  flushFiles();

  // Live empty Process while waiting before any activity.
  if (messageIsStreaming && segs.length === 0) {
    segs.push({
      type: 'process',
      id: `${messageId}-process-live`,
      steps: [],
      live: true,
    });
  }
  return segs;
}

/** Id of the last `content` segment, used to mark it as the streaming tail. */
export function findLastContentSegmentId(segments: TimelineSegment[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].type === 'content') return segments[i].id;
  }
  return undefined;
}
