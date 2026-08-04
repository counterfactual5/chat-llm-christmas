import { describe, expect, it } from 'vitest';
import {
  htmlFragmentToMarkdown,
  sectionsFromDocxHtml,
} from '@/lib/tools/docx-extract/tool';

describe('docx_extract helpers', () => {
  it('converts simple html fragments to markdown', () => {
    expect(htmlFragmentToMarkdown('<p>Hello <b>world</b></p>')).toBe('Hello world');
    expect(htmlFragmentToMarkdown('<h2>Title</h2><p>Body</p>')).toContain('## Title');
  });

  it('splits mammoth html into titled sections', () => {
    const sections = sectionsFromDocxHtml(
      '<h1>Intro</h1><p>One</p><h2>Next</h2><p>Two</p>',
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Intro');
    expect(sections[0].markdown).toContain('One');
    expect(sections[1].title).toBe('Next');
    expect(sections[1].markdown).toContain('Two');
  });
});
