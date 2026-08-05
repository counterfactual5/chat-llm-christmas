import { describe, expect, it } from 'vitest';
import {
  breakProseGluedToClosingFence,
  normalizeSameLineFences,
  unwrapMarkdownDocumentFence,
} from '@/lib/markdown/core/document-fence';
import { prepareChatMarkdown } from '@/lib/markdown/math';

describe('normalizeSameLineFences', () => {
  it('demotes same-line Windows path fences to inline code', () => {
    expect(normalizeSameLineFences('路径：```D:\\ComfyUI\\models\\```结束')).toBe(
      '路径：`D:\\ComfyUI\\models\\`结束',
    );
  });

  it('expands jammed language+body fences onto real lines', () => {
    expect(
      normalizeSameLineFences(
        '```bash git clone https://github.com/comfy-org/ComfyUI-Manager.git```',
      ),
    ).toBe(
      '```bash\ngit clone https://github.com/comfy-org/ComfyUI-Manager.git\n```\n',
    );
  });

  it('expands same-line numbered-step fences and breaks them off prose', () => {
    const src =
      '混合方案： ``` 1. GPT Image 生成图 2. 上传到云端 SVD 3. 下载视频 ```';
    expect(normalizeSameLineFences(src)).toBe(
      '混合方案： \n\n```\n1. GPT Image 生成图 2. 上传到云端 SVD 3. 下载视频\n```\n',
    );
  });

  it('leaves multi-line fences alone', () => {
    const src = '```bash\ngit clone x\n```';
    expect(normalizeSameLineFences(src)).toBe(src);
  });

  it('runs through prepareChatMarkdown before block reflow', () => {
    const src =
      '模型存放路径应该是： ```D:\\ComfyUI\\ComfyUI\\models\\``` --- ## 下一步';
    const out = prepareChatMarkdown(src);
    expect(out).toContain('`D:\\ComfyUI\\ComfyUI\\models\\`');
    expect(out).not.toMatch(/```D:/);
    expect(out).toMatch(/\n## 下一步/);
  });

  it('does not let a glued closing fence swallow following tables', () => {
    const src = [
      '方案： ``` 1. 生成图 2. 上传云端 3. 下载视频 ```这样你本地只需要跑基础节点。',
      '---',
      '## 总结建议',
      '| 优先级 | 方案 |',
      '| --- | --- |',
      '| 🥇 | 量化版 |',
    ].join(' ');
    const out = prepareChatMarkdown(src);
    expect(out).toMatch(/```\n/);
    expect(out).toMatch(/这样你本地/);
    expect(out).toContain('| 优先级 | 方案 |');
    // Must not keep the table inside an open fence.
    const fenceEnd = out.lastIndexOf('```');
    const tableAt = out.indexOf('| 优先级 |');
    expect(tableAt).toBeGreaterThan(fenceEnd);
  });
});

describe('breakProseGluedToClosingFence', () => {
  it('breaks prose glued to a closing fence but keeps opening lang tags', () => {
    expect(breakProseGluedToClosingFence('```\ncode\n```这样你')).toBe(
      '```\ncode\n```\n\n这样你',
    );
    expect(breakProseGluedToClosingFence('```bash\necho hi\n```')).toBe(
      '```bash\necho hi\n```',
    );
  });
});

describe('unwrapMarkdownDocumentFence', () => {
  it('unwraps a whole-document markdown fence', () => {
    const src = '```markdown\n## Hello\n\n- a\n```';
    expect(unwrapMarkdownDocumentFence(src)).toBe('## Hello\n\n- a');
  });
});
