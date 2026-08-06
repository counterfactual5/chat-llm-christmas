import type { MessageKey } from '@/lib/i18n';
import type { MessageToolRun } from '@/lib/chat/types';

/** Minimal shape needed to classify a tool run by provider/name. */
export type ClassifiableToolRun = Pick<MessageToolRun, 'name' | 'provider'>;

export type ToolRunClassification = {
  isNotion: boolean;
  isNotionFetch: boolean;
  isNotionWrite: boolean;
  isGitHub: boolean;
  isGoogle: boolean;
  isGmail: boolean;
  isCalendar: boolean;
  isDrive: boolean;
  isGoogleWrite: boolean;
  isWebRead: boolean;
  isPaperSearch: boolean;
  isBookSearch: boolean;
  isBookDownload: boolean;
  isPaperDownload: boolean;
  isGenerateImage: boolean;
  isCreateFile: boolean;
  isFileRead: boolean;
  isDocxExtract: boolean;
  isXlsxExtract: boolean;
  isSaveSkill: boolean;
  isImageUnderstand: boolean;
  isClaimReviewer: boolean;
  /** Manual `/review` per-turn audit step (local checks + optional verifier). */
  isReviewAudit: boolean;
  /** Manual `/review` independent LLM verifier call. */
  isReviewVerifier: boolean;
  /** Manual `/review` structured report write-up. */
  isReviewReport: boolean;
  isResearchPlan: boolean;
  isResearchSynthesize: boolean;
  isResearchVerify: boolean;
  isResearchWrite: boolean;
  isResearchSources: boolean;
  /** Research mixed/literature lane search (provider includes academic indexes). */
  isResearchAcademicSearch: boolean;
  isResearchMixedSearch: boolean;
  isPaperRead: boolean;
};

/** Classify a tool run by provider/name so the timeline can pick an icon + label. */
export function classifyToolRun(run: ClassifiableToolRun): ToolRunClassification {
  const isNotion =
    run.name.startsWith('notion_') ||
    run.name.startsWith('notion-') ||
    run.provider === 'notion';
  const isGitHub = run.provider === 'github' || /^github[-_]/i.test(run.name);
  const isGoogle =
    run.provider === 'google' || /^(gmail|calendar|drive)[-_]/i.test(run.name);
  const isGmail = isGoogle && /^gmail[-_]/i.test(run.name);
  const isCalendar = isGoogle && /^calendar[-_]/i.test(run.name);
  const isDrive = isGoogle && /^drive[-_]/i.test(run.name);
  const isNotionFetch = /fetch/i.test(run.name) && isNotion;
  const isNotionWrite =
    isNotion &&
    /create|update|move|duplicate|append|delete|trash|comment|write/i.test(run.name);
  const isGoogleWrite =
    isGoogle &&
    /create|update|send|reply|forward|delete|draft|modify|trash|batch|move|copy|share|revoke|upload|export|comment|acl|insert|write/i.test(
      run.name,
    );
  const isWebRead = run.name === 'web_read' || run.name === 'web-read';
  const isPaperSearch = run.name === 'paper_search';
  const isBookSearch = run.name === 'book_search';
  const isBookDownload = run.name === 'book_download';
  const isPaperDownload = run.name === 'paper_download';
  const isGenerateImage = run.name === 'generate_image';
  const isCreateFile =
    run.name === 'create_file' ||
    run.name === 'create-file' ||
    run.name === 'create_spreadsheet';
  const isFileRead = run.name === 'file_read' || run.provider === 'file-read';
  const isDocxExtract =
    run.name === 'docx_extract' || run.provider === 'docx-extract';
  const isXlsxExtract =
    run.name === 'xlsx_extract' || run.provider === 'xlsx-extract';
  const isSaveSkill = run.name === 'save_skill' || run.provider === 'skills';
  const isImageUnderstand =
    run.name === 'image_understand' ||
    run.provider === 'zhipu-vision' ||
    run.provider === 'image-understand' ||
    run.provider === 'glm-ocr' ||
    run.provider === 'nemotron-omni';
  const isClaimReviewer = run.provider === 'claim-reviewer';
  const isReviewAudit = run.provider === 'review' && run.name === 'claim_audit';
  const isReviewVerifier = run.provider === 'review' && run.name === 'claim_verifier';
  const isReviewReport = run.provider === 'review' && run.name === 'review_report';
  const isResearchPlan = run.name === 'research_plan';
  const isResearchSynthesize = run.name === 'research_synthesize';
  const isResearchVerify = run.name === 'research_verify';
  const isResearchWrite = run.name === 'research_write';
  const isResearchSources = run.name === 'research_sources';
  const isPaperRead = run.name === 'paper_read';
  const provider = String(run.provider || '');
  const providerHasPaper = /openalex|arxiv|semantic|literature|\bs2\b/i.test(provider);
  const providerHasWeb =
    /zhipu|tavily|brave|serper|parallel|duckduckgo|wikipedia|google_news|google-news/i.test(
      provider,
    );
  // Research search tools are emitted as web_search; lane is encoded in provider.
  const isResearchMixedSearch =
    run.name === 'web_search' && providerHasPaper && providerHasWeb;
  const isResearchAcademicSearch =
    (run.name === 'web_search' && providerHasPaper && !providerHasWeb) ||
    /^literature:/i.test(provider);

  return {
    isNotion,
    isNotionFetch,
    isNotionWrite,
    isGitHub,
    isGoogle,
    isGmail,
    isCalendar,
    isDrive,
    isGoogleWrite,
    isWebRead,
    isPaperSearch,
    isBookSearch,
    isBookDownload,
    isPaperDownload,
    isGenerateImage,
    isCreateFile,
    isFileRead,
    isDocxExtract,
    isXlsxExtract,
    isSaveSkill,
    isImageUnderstand,
    isClaimReviewer,
    isReviewAudit,
    isReviewVerifier,
    isReviewReport,
    isResearchPlan,
    isResearchSynthesize,
    isResearchVerify,
    isResearchWrite,
    isResearchSources,
    isResearchAcademicSearch,
    isResearchMixedSearch,
    isPaperRead,
  };
}

/**
 * Pick the i18n key for a tool run's status line, given its classification
 * plus in-flight / failure state. Caller resolves the key via `t()`.
 */
/** Per-tool labels for Gmail send-family approval UI. */
export function getGmailApprovalLabelKey(
  toolName: string,
  phase: 'awaiting' | 'sent' | 'cancelled',
): MessageKey {
  const name = String(toolName || '').toLowerCase().replace(/-/g, '_');
  if (name === 'gmail_reply') {
    if (phase === 'awaiting') return 'emailAwaitingReply';
    if (phase === 'sent') return 'emailReplySent';
    return 'emailReplyCancelled';
  }
  if (name === 'gmail_forward') {
    if (phase === 'awaiting') return 'emailAwaitingForward';
    if (phase === 'sent') return 'emailForwardSent';
    return 'emailForwardCancelled';
  }
  if (name === 'gmail_send_draft') {
    if (phase === 'awaiting') return 'emailAwaitingSendDraft';
    if (phase === 'sent') return 'emailDraftSent';
    return 'emailDraftCancelled';
  }
  // gmail_send and fallback
  if (phase === 'awaiting') return 'emailAwaitingSend';
  if (phase === 'sent') return 'emailSent';
  return 'emailCancelled';
}

export function getToolRunLabelKey(
  classification: ToolRunClassification,
  state: {
    searching: boolean;
    failed: boolean;
    awaitingApproval?: boolean;
    approvalOutcome?: 'sent' | 'cancelled';
    toolName?: string;
  },
): MessageKey {
  const {
    isNotion,
    isNotionFetch,
    isNotionWrite,
    isGitHub,
    isGoogle,
    isGmail,
    isCalendar,
    isDrive,
    isGoogleWrite,
    isWebRead,
    isPaperSearch,
    isBookSearch,
    isBookDownload,
    isPaperDownload,
    isGenerateImage,
    isCreateFile,
    isFileRead,
    isDocxExtract,
    isXlsxExtract,
    isSaveSkill,
    isImageUnderstand,
    isClaimReviewer,
    isReviewAudit,
    isReviewVerifier,
    isReviewReport,
    isResearchPlan,
    isResearchSynthesize,
    isResearchVerify,
    isResearchWrite,
    isResearchSources,
    isResearchAcademicSearch,
    isResearchMixedSearch,
    isPaperRead,
  } = classification;
  const { searching, failed, awaitingApproval, approvalOutcome, toolName } = state;

  if (awaitingApproval) return getGmailApprovalLabelKey(toolName || '', 'awaiting');
  if (approvalOutcome === 'sent') return getGmailApprovalLabelKey(toolName || '', 'sent');
  if (approvalOutcome === 'cancelled') {
    return getGmailApprovalLabelKey(toolName || '', 'cancelled');
  }

  if (isReviewAudit) {
    if (failed) return 'toolFailed';
    return searching ? 'reviewAuditing' : 'reviewAudited';
  }
  if (isReviewVerifier) {
    if (failed) return 'toolFailed';
    return searching ? 'reviewVerifying' : 'reviewVerified';
  }
  if (isReviewReport) {
    if (failed) return 'toolFailed';
    return searching ? 'reviewWriting' : 'reviewWrote';
  }

  if (isResearchPlan) {
    if (failed) return 'toolFailed';
    return searching ? 'researchPlanning' : 'researchPlanned';
  }
  if (isResearchSynthesize) {
    if (failed) return 'toolFailed';
    return searching ? 'researchSynthesizing' : 'researchSynthesized';
  }
  if (isResearchVerify) {
    if (failed) return 'toolFailed';
    return searching ? 'researchVerifying' : 'researchVerified';
  }
  if (isResearchWrite) {
    if (failed) return 'toolFailed';
    return searching ? 'researchWriting' : 'researchWrote';
  }
  if (isResearchSources) {
    return searching ? 'collectingSources' : 'collectedSources';
  }
  if (isResearchMixedSearch) {
    if (failed) return 'toolFailed';
    return searching ? 'searchingMixed' : 'searchedMixed';
  }
  if (isResearchAcademicSearch) {
    if (failed) return 'toolFailed';
    return searching ? 'searchingPapers' : 'searchedPapers';
  }
  if (isPaperRead) {
    if (failed) return 'toolFailed';
    return searching ? 'readingPaper' : 'readPaper';
  }
  if (isClaimReviewer) {
    return searching ? 'reviewingClaims' : 'reviewedClaims';
  }
  if (isGoogle) {
    if (failed) return 'toolFailed';
    if (isGoogleWrite) return searching ? 'writingGoogle' : 'wroteGoogle';
    if (isGmail) return searching ? 'searchingGmail' : 'searchedGmail';
    if (isCalendar) return searching ? 'searchingCalendar' : 'searchedCalendar';
    if (isDrive) return searching ? 'searchingDrive' : 'searchedDrive';
    return searching ? 'searchingGoogle' : 'searchedGoogle';
  }
  if (searching) {
    if (isNotionWrite) return 'writingNotion';
    if (isNotionFetch) return 'readingNotion';
    if (isNotion) return 'searchingNotion';
    if (isGitHub) return 'searchingGitHub';
    if (isImageUnderstand) return 'understandingImage';
    if (isGenerateImage) return 'generatingImageTool';
    if (isPaperSearch) return 'searchingPapers';
    if (isBookSearch) return 'searchingBooks';
    if (isBookDownload) return 'downloadingBook';
    if (isPaperDownload) return 'downloadingPaper';
    if (isCreateFile) return 'creatingFile';
    if (isFileRead) return 'readingFile';
    if (isDocxExtract) return 'extractingDocx';
    if (isXlsxExtract) return 'extractingXlsx';
    if (isSaveSkill) return 'savingSkill';
    if (isWebRead) return 'readingWeb';
    return 'searchingWeb';
  }
  if (failed) return 'toolFailed';
  if (isNotionWrite) return 'wroteNotion';
  if (isNotionFetch) return 'readNotion';
  if (isNotion) return 'searchedNotion';
  if (isGitHub) return 'searchedGitHub';
  if (isImageUnderstand) return 'understoodImage';
  if (isGenerateImage) return 'generatedImageTool';
  if (isPaperSearch) return 'searchedPapers';
  if (isBookSearch) return 'searchedBooks';
  if (isBookDownload) return 'downloadedBook';
  if (isPaperDownload) return 'downloadedPaper';
  if (isCreateFile) return 'createdFile';
  if (isFileRead) return 'readFile';
  if (isDocxExtract) return 'extractedDocx';
  if (isXlsxExtract) return 'extractedXlsx';
  if (isSaveSkill) return 'savedSkill';
  if (isWebRead) return 'readWeb';
  return 'searchedWeb';
}

/**
 * "Fetching results…" only for tools that actually pull hit lists.
 * Research Plan / Synthesize / Verify / Write share status:"start" with
 * searches but must never show this subtitle.
 */
export function toolRunShowsFetchingResults(
  classification: ToolRunClassification,
): boolean {
  if (
    classification.isResearchPlan ||
    classification.isResearchSynthesize ||
    classification.isResearchVerify ||
    classification.isResearchWrite ||
    classification.isWebRead ||
    classification.isPaperRead ||
    classification.isGenerateImage ||
    classification.isCreateFile ||
    classification.isFileRead ||
    classification.isDocxExtract ||
    classification.isXlsxExtract ||
    classification.isSaveSkill ||
    classification.isImageUnderstand ||
    classification.isClaimReviewer ||
    classification.isReviewAudit ||
    classification.isReviewVerifier ||
    classification.isReviewReport ||
    classification.isBookDownload ||
    classification.isPaperDownload ||
    classification.isNotionWrite ||
    classification.isNotionFetch ||
    classification.isGoogleWrite
  ) {
    return false;
  }
  // Explicit search-shaped tools (including research mixed/academic lanes).
  if (
    classification.isPaperSearch ||
    classification.isBookSearch ||
    classification.isResearchSources ||
    classification.isResearchMixedSearch ||
    classification.isResearchAcademicSearch ||
    classification.isNotion ||
    classification.isGitHub ||
    classification.isGoogle
  ) {
    return true;
  }
  // Remaining in-flight default is web_search.
  return true;
}
