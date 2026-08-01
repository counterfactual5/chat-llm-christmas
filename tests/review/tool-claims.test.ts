import { describe, expect, it } from 'vitest';
import {
  detectFakedToolNarration,
  detectPendingToolIntent,
} from '@/lib/tools/review/claim-reviewer';

const options = { searchEnabled: true, integrations: [] as string[] };

describe('tool claim detection', () => {
  it('does not treat search tutorials and pseudo calls as completed searches', () => {
    const tutorial = [
      '获取方式',
      '',
      'web_search：使用关键词检索最近 24 小时内的网页。',
      '从搜索结果中挑选带有明确时间戳的页面，例如 https://www.coingecko.com。',
      '',
      '```text',
      'web_search(query="BTC price")',
      '-> 结果：https://example.com',
      '```',
    ].join('\n');

    expect(detectFakedToolNarration(tutorial, options)).toEqual([]);
  });

  it('still catches explicit search-result claims with links and no receipt', () => {
    expect(
      detectFakedToolNarration(
        '根据搜索结果，最新价格已经上涨：https://example.com/price',
        options,
      ),
    ).toContain('web_search');
    expect(
      detectFakedToolNarration(
        '搜索结果显示该项目本周完成融资：https://example.com/news',
        options,
      ),
    ).toContain('web_search');
  });

  it('ignores completed-search language when it only appears inside a code example', () => {
    expect(
      detectFakedToolNarration(
        '示例：\n```markdown\n根据搜索结果：https://example.com\n```',
        options,
      ),
    ).toEqual([]);
  });

  it('ignores examples, rules, negation, quotations, and conditional wording', () => {
    const integrations = ['notion', 'github', 'gmail', 'calendar', 'drive'];
    const cases = [
      '反例：已创建 Notion 页面 https://notion.so/fake，不要这样声称。',
      '> 我已经发送邮件了。',
      '如果已经创建 PR，就可以在下一步添加评论。',
      '模型不得声称已经保存 Skill。',
      '说明：文件卡片用于展示 create_file 的成功结果。',
      '例如，已创建 report.pdf 可以作为成功提示。',
      '我可以先用 create_file 把 Skill 内容导出为 .md 文件保存到本地。',
    ];

    for (const text of cases) {
      expect(
        detectFakedToolNarration(text, {
          searchEnabled: true,
          integrations,
          skillCreator: true,
        }),
      ).toEqual([]);
    }
  });

  it('requires direct, local completion statements for integration writes', () => {
    expect(
      detectFakedToolNarration('我已经创建了 Notion 页面。', {
        searchEnabled: false,
        integrations: ['notion'],
      }),
    ).toContain('notion');
    expect(
      detectFakedToolNarration('我刚刚发送了邮件。', {
        searchEnabled: false,
        integrations: ['gmail'],
      }),
    ).toContain('gmail');
    expect(
      detectFakedToolNarration('我已创建 report.pdf 文件。', options),
    ).toContain('create_file');
  });

  it('only treats an immediate tail promise as pending tool intent', () => {
    const tutorial = [
      '操作流程：先搜索，再读取网页。',
      '这样可以获得较完整的上下文。',
      '最后把数据整理成表格。',
    ].join('\n');
    expect(detectPendingToolIntent(tutorial, options)).toEqual([]);
    expect(detectPendingToolIntent('我现在去搜索一下。', options)).toContain(
      'web_search',
    );
    expect(
      detectPendingToolIntent('如果需要最新数据，可以先搜索。', options),
    ).toEqual([]);
  });
});
