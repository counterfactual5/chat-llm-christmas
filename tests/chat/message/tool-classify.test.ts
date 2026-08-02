import { describe, expect, it } from 'vitest';
import {
  classifyToolRun,
  getToolRunLabelKey,
  toolRunShowsFetchingResults,
} from '@/lib/chat/message/tool-classify';

describe('classifyToolRun', () => {
  it('detects Notion runs by name prefix or provider', () => {
    expect(classifyToolRun({ name: 'notion_search' }).isNotion).toBe(true);
    expect(classifyToolRun({ name: 'notion-fetch' }).isNotion).toBe(true);
    expect(classifyToolRun({ name: 'anything', provider: 'notion' }).isNotion).toBe(true);
    expect(classifyToolRun({ name: 'web_search' }).isNotion).toBe(false);
  });

  it('flags Notion fetch vs write runs', () => {
    expect(classifyToolRun({ name: 'notion-fetch' }).isNotionFetch).toBe(true);
    expect(classifyToolRun({ name: 'notion_search' }).isNotionFetch).toBe(false);
    expect(classifyToolRun({ name: 'notion_create_page' }).isNotionWrite).toBe(true);
    expect(classifyToolRun({ name: 'notion_search' }).isNotionWrite).toBe(false);
  });

  it('detects GitHub runs', () => {
    expect(classifyToolRun({ name: 'github-search' }).isGitHub).toBe(true);
    expect(classifyToolRun({ name: 'anything', provider: 'github' }).isGitHub).toBe(true);
    expect(classifyToolRun({ name: 'web_search' }).isGitHub).toBe(false);
  });

  it('detects Google runs and sub-providers', () => {
    const gmail = classifyToolRun({ name: 'gmail-send' });
    expect(gmail.isGoogle).toBe(true);
    expect(gmail.isGmail).toBe(true);
    expect(gmail.isCalendar).toBe(false);
    expect(gmail.isDrive).toBe(false);
    expect(gmail.isGoogleWrite).toBe(true);

    const calendar = classifyToolRun({ name: 'calendar-list' });
    expect(calendar.isCalendar).toBe(true);
    expect(calendar.isGoogleWrite).toBe(false);

    const drive = classifyToolRun({ name: 'drive-upload' });
    expect(drive.isDrive).toBe(true);
    expect(drive.isGoogleWrite).toBe(true);
  });

  it('detects web read, file/skill writes, image-understand, literature, generate-image, and claim-reviewer runs', () => {
    expect(classifyToolRun({ name: 'web_read' }).isWebRead).toBe(true);
    expect(classifyToolRun({ name: 'web-read' }).isWebRead).toBe(true);
    expect(classifyToolRun({ name: 'create_file' }).isCreateFile).toBe(true);
    expect(classifyToolRun({ name: 'save_skill', provider: 'skills' }).isSaveSkill).toBe(true);
    expect(classifyToolRun({ name: 'image_understand' }).isImageUnderstand).toBe(true);
    expect(classifyToolRun({ name: 'x', provider: 'glm-ocr' }).isImageUnderstand).toBe(true);
    expect(classifyToolRun({ name: 'paper_search' }).isPaperSearch).toBe(true);
    expect(classifyToolRun({ name: 'book_search' }).isBookSearch).toBe(true);
    expect(classifyToolRun({ name: 'book_download' }).isBookDownload).toBe(true);
    expect(classifyToolRun({ name: 'generate_image' }).isGenerateImage).toBe(true);
    expect(classifyToolRun({ name: 'x', provider: 'claim-reviewer' }).isClaimReviewer).toBe(true);
  });
});

describe('getToolRunLabelKey', () => {
  it('prioritizes claim-reviewer over everything else', () => {
    const c = classifyToolRun({ name: 'x', provider: 'claim-reviewer' });
    expect(getToolRunLabelKey(c, { searching: true, failed: false })).toBe('reviewingClaims');
    expect(getToolRunLabelKey(c, { searching: false, failed: false })).toBe('reviewedClaims');
  });

  it('reports a failed Google run as toolFailed even while searching', () => {
    const c = classifyToolRun({ name: 'gmail-send' });
    expect(getToolRunLabelKey(c, { searching: true, failed: true })).toBe('toolFailed');
  });

  it('picks the right Google sub-label by write/gmail/calendar/drive', () => {
    expect(
      getToolRunLabelKey(classifyToolRun({ name: 'gmail-search' }), {
        searching: true,
        failed: false,
      }),
    ).toBe('searchingGmail');
    expect(
      getToolRunLabelKey(classifyToolRun({ name: 'gmail-send' }), {
        searching: false,
        failed: false,
      }),
    ).toBe('wroteGoogle');
    expect(
      getToolRunLabelKey(classifyToolRun({ name: 'calendar-list' }), {
        searching: false,
        failed: false,
      }),
    ).toBe('searchedCalendar');
    expect(
      getToolRunLabelKey(classifyToolRun({ name: 'drive-list' }), {
        searching: true,
        failed: false,
      }),
    ).toBe('searchingDrive');
  });

  it('falls back through Notion / GitHub / image / literature / create-file / web-read / web-search', () => {
    const cases: Array<[Parameters<typeof classifyToolRun>[0], boolean, string]> = [
      [{ name: 'notion_create_page' }, true, 'writingNotion'],
      [{ name: 'notion_create_page' }, false, 'wroteNotion'],
      [{ name: 'notion-fetch' }, true, 'readingNotion'],
      [{ name: 'notion-fetch' }, false, 'readNotion'],
      [{ name: 'notion_search' }, true, 'searchingNotion'],
      [{ name: 'notion_search' }, false, 'searchedNotion'],
      [{ name: 'github-search' }, true, 'searchingGitHub'],
      [{ name: 'github-search' }, false, 'searchedGitHub'],
      [{ name: 'image_understand' }, true, 'understandingImage'],
      [{ name: 'image_understand' }, false, 'understoodImage'],
      [{ name: 'generate_image' }, true, 'generatingImageTool'],
      [{ name: 'generate_image' }, false, 'generatedImageTool'],
      [{ name: 'paper_search' }, true, 'searchingPapers'],
      [{ name: 'paper_search' }, false, 'searchedPapers'],
      [{ name: 'book_search' }, true, 'searchingBooks'],
      [{ name: 'book_search' }, false, 'searchedBooks'],
      [{ name: 'book_download' }, true, 'downloadingBook'],
      [{ name: 'book_download' }, false, 'downloadedBook'],
      [{ name: 'create_file' }, true, 'creatingFile'],
      [{ name: 'create_file' }, false, 'createdFile'],
      [{ name: 'save_skill', provider: 'skills' }, true, 'savingSkill'],
      [{ name: 'save_skill', provider: 'skills' }, false, 'savedSkill'],
      [{ name: 'web_read' }, true, 'readingWeb'],
      [{ name: 'web_read' }, false, 'readWeb'],
      [{ name: 'web_search' }, true, 'searchingWeb'],
      [{ name: 'web_search' }, false, 'searchedWeb'],
    ];
    for (const [run, searching, expected] of cases) {
      const classification = classifyToolRun(run);
      expect(getToolRunLabelKey(classification, { searching, failed: false })).toBe(expected);
    }
  });

  it('reports toolFailed for a failed non-Google run once done', () => {
    const c = classifyToolRun({ name: 'web_search' });
    expect(getToolRunLabelKey(c, { searching: false, failed: true })).toBe('toolFailed');
  });
});

describe('toolRunShowsFetchingResults', () => {
  it('hides the subtitle for research plan / write stages', () => {
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'research_plan' })),
    ).toBe(false);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'research_synthesize' })),
    ).toBe(false);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'research_verify' })),
    ).toBe(false);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'research_write' })),
    ).toBe(false);
  });

  it('keeps the subtitle for web / paper / book search', () => {
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'web_search' })),
    ).toBe(true);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'research_sources' })),
    ).toBe(true);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'paper_search' })),
    ).toBe(true);
    expect(
      toolRunShowsFetchingResults(classifyToolRun({ name: 'book_search' })),
    ).toBe(true);
  });
});
