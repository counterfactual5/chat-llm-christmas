import { describe, expect, it } from 'vitest';
import { reflowCollapsedMarkdownBlocks } from '@/lib/markdown/core/blocks';
import { prepareChatMarkdown } from '@/lib/markdown/math';

/** Pattern from GLM replies that collapse every block newline into a space. */
const SMASHED = [
  '你说的对，我核对了 **2026 年 8 月** 的现状。',
  '---',
  '## ✅ 经过验证的、当前活跃的渠道',
  '### 1. 电鸭社区',
  '- 状态：国内运营',
  '- 网址：https://eleduck.com',
  '- 特点：远程工作',
  '### 2. DeJob',
  '- 状态：活跃',
  '---',
  '## ⚠️ 已经失效/关停的平台',
  '| 平台 | 状态 | 说明 |',
  '|------|------|------|',
  '| 登链社区主站 (dengchain.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |',
  '| Dework (dework.com) | ❌ 域名已售卖 | GoDaddy |',
  '---',
  '## 🎯 针对你的情况（Solidity 开发）的求职路径建议',
  '**我的建议：既然很多老平台都关了，不要再花时间找"赏金任务"了。**',
  '### 路径 1: 进入核心开发者社区：',
  '1. 加入 DeJob Telegram',
  '2. 加入 Solidity Developers',
  '找 `good first issue`。',
].join(' ');

describe('reflowCollapsedMarkdownBlocks', () => {
  it('restores headings, lists, hrs, and tables from a fully smashed reply', () => {
    const out = reflowCollapsedMarkdownBlocks(SMASHED);

    expect(out).toMatch(/\n## ✅ 经过验证/);
    expect(out).toMatch(/\n### 1\. 电鸭社区/);
    expect(out).toMatch(/\n- 状态：国内运营/);
    expect(out).toMatch(/\n- 网址：https:\/\/eleduck\.com/);
    expect(out).toMatch(/\n## ⚠️ 已经失效/);
    expect(out).toMatch(/\n\| 平台 \|/);
    expect(out).toMatch(/\n\|------\|/);
    expect(out).toMatch(/\n\| 登链社区主站/);
    expect(out).toMatch(/\n### 路径 1:/);
    expect(out).toMatch(/\n1\. 加入 DeJob/);
    expect(out).toMatch(/\n2\. 加入 Solidity/);

    // HR must be isolated so it is not a setext underline.
    expect(out).toMatch(/\n\n---\n\n## ✅/);
  });

  it('does not alter fenced code blocks', () => {
    const src = '前言 ```\n## not a heading\n- not a list\n``` 后记 ## 真标题';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toContain('```\n## not a heading\n- not a list\n```');
    expect(out).toMatch(/后记\n\n## 真标题/);
  });

  it('runs through prepareChatMarkdown', () => {
    const out = prepareChatMarkdown(SMASHED);
    expect(out).toMatch(/\n## ✅/);
    expect(out).toMatch(/\n- 状态：/);
    expect(out.split('\n').length).toBeGreaterThan(10);
  });

  it('splits prose that trails a smashed table row', () => {
    const smashed =
      '| 平台 | 状态 | |------|------| | Dework | 已售 | **我的建议：别找赏金了。** 1. 加入 DeJob 2. 加入群';
    const out = reflowCollapsedMarkdownBlocks(smashed);
    expect(out).toMatch(/\|\s*Dework[^\n]*\|\s*\n\n\*\*我的建议/);
    expect(out).toMatch(/\*\*\s*\n\n1\. 加入 DeJob/);
    expect(out).toMatch(/\n2\. 加入群/);
  });

  it('keeps a bold last cell inside its row instead of starting a paragraph', () => {
    const smashed =
      '| 维度 | HTTP/1.1 | HTTP/2 | HTTP/3 | | :--- | :--- | :--- | :--- | | **传输协议** | TCP | TCP | **UDP (QUIC)** | | **连接建立** | TCP → TLS | TCP → TLS | **QUIC (合并握手，支持 0-RTT)** |';
    const out = reflowCollapsedMarkdownBlocks(smashed);
    expect(out).toContain('| **传输协议** | TCP | TCP | **UDP (QUIC)** |');
    expect(out).toContain(
      '| **连接建立** | TCP → TLS | TCP → TLS | **QUIC (合并握手，支持 0-RTT)** |',
    );
    expect(out).not.toMatch(/\n\*\*UDP \(QUIC\)\*\* \|/);
  });

  it('isolates a thematic break glued straight onto a sentence', () => {
    const out = reflowCollapsedMarkdownBlocks(
      '每个库都有其特定的应用场景。---\n\n数据分析的基本流程如下。',
    );
    expect(out).toMatch(/应用场景。\n\n---\n\n数据分析/);
  });

  it('normalizes dash-like thematic breaks (non-ASCII) into HR', () => {
    const out = reflowCollapsedMarkdownBlocks(
      '每个库都有其特定的应用场景。———\n\n数据分析的基本流程如下。',
    );
    expect(out).toMatch(/应用场景。\n\n---\n\n数据分析/);
  });

  it('does not rewrite mid-prose Chinese em-dashes into HR markers', () => {
    const src = '前后———中间内容———后面';
    expect(reflowCollapsedMarkdownBlocks(src)).toBe(src);
  });

  it('keeps the last table cell intact (no false split before CJK cell text)', () => {
    const smashed =
      '⚠️ 已经失效/关停的平台（不要浪费时间） | 平台 | 状态 | 说明 | |------|------|------| | 登链社区主站 (dengchain.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 | | Dework (dework.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |';
    const out = reflowCollapsedMarkdownBlocks(smashed);
    expect(out).toMatch(/^⚠️ 已经失效\/关停的平台（不要浪费时间）\n\n\| 平台 \|/);
    expect(out).toContain('| 登链社区主站 (dengchain.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |');
    expect(out).toContain('| Dework (dework.com) | ❌ 域名已售卖 | 已被 GoDaddy 挂售 |');
    expect(out).not.toMatch(/域名已售卖 \|\n\n已被/);
  });

  it('does not split inside a table row when the first cell has CJK punctuation', () => {
    const smashed =
      '| ⚠️ 已经失效/关停的平台（不要浪费时间） | 平台 | 状态 | |------|------|------| | 登链 | ❌ | 售 |';
    const out = reflowCollapsedMarkdownBlocks(smashed);
    expect(out).toContain('| ⚠️ 已经失效/关停的平台（不要浪费时间） | 平台 | 状态 |');
    expect(out).not.toMatch(/不要浪费时间）\n\n\| 平台/);
  });

  it('breaks CTA and URL-adjacent field bullets onto new lines', () => {
    const out = reflowCollapsedMarkdownBlocks(
      [
        '- 网址：https://eleduck.com - 特点：国内最早的远程工作社区之一',
        '3. 长期：保持 Telegram 群组活跃，建立人脉 需要我帮你：',
      ].join('\n'),
    );
    expect(out).toContain('https://eleduck.com\n- 特点：');
    expect(out).toContain('建立人脉\n\n需要我帮你：');
  });

  it('keeps **/command** - description on one list item', () => {
    const src = [
      '📋 可用命令（在输入框输入 `/` 查看）',
      '',
      '- **/image** - 生成图片',
      '- **/research** - 深度研究（标准/严谨）',
      '- **/papers** - 搜论文',
      '- **/books** - 搜书籍',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toContain('- **/image** - 生成图片');
    expect(out).toContain('- **/research** - 深度研究（标准/严谨）');
    expect(out).not.toMatch(/\*\*\n\n- 生成图片/);
    expect(out).not.toMatch(/\*\*\n\n- 深度研究/);
  });

  it('does not turn normal Chinese prose dashes or figure numbers into lists', () => {
    expect(reflowCollapsedMarkdownBlocks('从技术角度 - 这并不复杂，价格 - 约一百。')).toBe(
      '从技术角度 - 这并不复杂，价格 - 约一百。',
    );
    expect(
      reflowCollapsedMarkdownBlocks('详见下图 1. 整体架构，以及表 2. 对比结果。'),
    ).toBe('详见下图 1. 整体架构，以及表 2. 对比结果。');
    expect(
      reflowCollapsedMarkdownBlocks('本次更新包括版本 2. 性能优化与版本 3. 文档。'),
    ).toBe('本次更新包括版本 2. 性能优化与版本 3. 文档。');
  });

  it('splits consecutive ordered items after a hard-punct break only', () => {
    const out = reflowCollapsedMarkdownBlocks(
      '你现在的策略应该是： 1. 本周内投简历 2. 同时逛 GitHub 3. 长期加人脉',
    );
    expect(out).toMatch(/应该是：\n1\. 本周内投简历\n2\. 同时逛 GitHub\n3\. 长期加人脉/);
  });

  it('splits mid-line headings/HRs after Latin (step-style smash)', () => {
    const smashed = [
      '有 NVIDIA → 选 nvidia 或 nvidia_cu126',
      '- 有 AMD → 选 amd',
      '- 只有 Intel 核显 → 选 intel ### 第二步：区分 nvidia vs nvidia_cu126 | 情况 | 推荐选择 | 原因 |',
      '|------|---------|------|',
      '| 已安装 CUDA Toolkit（比如 12.x） | nvidia_cu126 | 匹配系统 CUDA，启动更快 |',
      '| 没装 CUDA / 不确定 | nvidia | 自带运行时，避免报错「找不到 CUDA」 | ---',
      '',
      '**简单选择口诀：**',
      '- Intel 核显 → 下 intel ---',
      '',
      '建议下载：`ComfyUI_windows_portable_nvidia_cu126.7z` 即可。 --- 需要我帮你确认你的显卡型号吗？',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(smashed);

    expect(out).toMatch(/选 intel\n\n### 第二步：区分 nvidia vs nvidia_cu126/);
    expect(out).toMatch(/\n\| 情况 \| 推荐选择 \| 原因 \|/);
    expect(out).toMatch(/\|\n\n---\n/);
    expect(out).toMatch(/下 intel\n\n---/);
    expect(out).toMatch(/即可。\n\n---\n\n需要我帮你确认/);
  });

  it('splits colon-led bullets without breaking **/cmd** catalogs', () => {
    const out = reflowCollapsedMarkdownBlocks(
      'Windows 便携版对 Mac 支持有限： - Mac通常使用 Apple Silicon - 官方便携版主要面向 Windows',
    );
    expect(out).toMatch(/支持有限：\n- Mac通常使用 Apple Silicon\n- 官方便携版主要面向 Windows/);
    expect(
      reflowCollapsedMarkdownBlocks('- **/image** - 生成图片\n- **/research** - 深度研究'),
    ).toContain('- **/image** - 生成图片');
  });

  it('joins Step mid-word hard wraps without merging real blocks', () => {
    const smashed = [
      '- **SVD 工作流 = 本地运行**，模型下载一次，之后完全离线',
      '- **云端 = 备选方**',
      '案，仅在你硬件跑不动时用来“租算力”',
      '- 唯一可能涉及云端的部分是 **GPT Image API**',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(smashed);
    expect(out).toContain('- **云端 = 备选方**案，仅在你硬件跑不动时用来“租算力”');
    expect(out).toMatch(/离线\n- \*\*云端/);
    expect(out).toMatch(/租算力”\n- 唯一可能/);
  });

  it('does not glue a closed code span onto 第二步', () => {
    const src = [
      '- 只有 Intel → 选 `_intel`',
      '第二步：区分 nvidia VS nvidia_cu126 | 情况 | 推荐选择 | 原因 |',
      '|------|---------|------|',
      '| 已装 | nvidia | 小 |',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toContain('选 `_intel`\n\n第二步：');
    expect(out).not.toContain('`_intel`第二步');
    expect(out).toMatch(/第二步：区分 nvidia VS nvidia_cu126\n\n\| 情况 \|/);
  });

  it('recovers tables that use U+2028 row breaks or box-drawing pipes', () => {
    const src = [
      '第二步：区分 nvidia VS nvidia_cu126 │ 情况 │ 推荐选择 │ 原因 │',
      '│------│---------│------│',
      '│ 已装 CUDA │ nvidia │ 小 │',
    ].join('\u2028');
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/第二步：区分 nvidia VS nvidia_cu126\n\n\| 情况 \|/);
    expect(out).toContain('|------|---------|------|');
    expect(out).toContain('| 已装 CUDA | nvidia | 小 |');
  });

  it('does not rewrite plain-text pipe lookalikes or bare 第二步去…', () => {
    const prose = [
      '请在选项 A │ 选项 B 中二选一——不要改成 Markdown 表。',
      '- 先注册',
      '第二步去验证邮箱即可。',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(prose);
    expect(out).toContain('选项 A │ 选项 B');
    expect(out).toContain('二选一——不要改成');
    expect(out).toContain('- 先注册\n第二步去验证邮箱即可。');
    expect(out).not.toContain('- 先注册\n\n第二步去');
  });

  it('does not turn English em-dash prose into thematic breaks', () => {
    const src = 'Choose option A --- not B when both look valid.';
    expect(reflowCollapsedMarkdownBlocks(src)).toBe(src);
  });

  it('joins long hard-wrapped CJK prose lines', () => {
    const line1 =
      '- Mac 通常使用 Apple Silicon (M1/M2/M3) 或 Intel 芯片 - 官方 portable 包主要是为 Windows 设计的 - Mac 上运';
    const line2 = '行 ComfyUI 通常需要：';
    const out = reflowCollapsedMarkdownBlocks(`${line1}\n${line2}`);
    expect(out).toContain('Mac 上运行 ComfyUI 通常需要：');
    expect(out).not.toMatch(/运\n行/);
  });

  it('does not join short poem-like CJK lines', () => {
    const poem = ['床前明月光', '疑是地上霜', '举头望明月'].join('\n');
    expect(reflowCollapsedMarkdownBlocks(poem)).toBe(poem);
  });

  it('does not rewrite already-correct headings, hrs, or tables', () => {
    const ok = [
      '选 intel',
      '',
      '### 第二步：区分版本',
      '',
      '| 情况 | 推荐 |',
      '| --- | --- |',
      '| 已装 CUDA | cu126 |',
      '',
      '---',
      '',
      '需要我帮你确认吗？',
    ].join('\n');
    expect(reflowCollapsedMarkdownBlocks(ok)).toBe(ok);
  });

  it('does not break GFM tables that omit outer pipes', () => {
    const ok = ['Name | Age | City', '--- | --- | ---', 'Ann | 3 | NY'].join('\n');
    const out = reflowCollapsedMarkdownBlocks(ok);
    // Separator must stay a delimiter row — never become a thematic break.
    expect(out).toContain('--- | --- | ---');
    expect(out).not.toMatch(/\n---\n\n\|/);
    // Body row may gain outer pipes via orphan-row repair; header/sep stay.
    expect(out).toMatch(/Name \| Age \| City/);
    expect(out).toMatch(/Ann \| 3 \| NY/);
  });

  it('still splits HR-then-prose without touching table separators', () => {
    expect(reflowCollapsedMarkdownBlocks('前言 --- 需要我帮你吗？')).toMatch(
      /前言\n\n---\n\n需要我帮你吗？/,
    );
  });

  it('splits HR glued after a table row before trailing prose', () => {
    const src = [
      '| 优先级 | 方案 |',
      '| --- | --- |',
      '| 🥇 | 量化版 | --- 建议你先试这个。',
    ].join('\n');
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/\|\s*🥇\s*\|\s*量化版\s*\|\s*\n\n---\n\n\s*建议你先试/);
    expect(out).toContain('--- | ---');
  });

  it('keeps normal headings that contain version-like decimals', () => {
    expect(reflowCollapsedMarkdownBlocks('## HTTP 1.1 概述')).toBe('## HTTP 1.1 概述');
    expect(reflowCollapsedMarkdownBlocks('## 1. 介绍')).toBe('## 1. 介绍');
    expect(reflowCollapsedMarkdownBlocks('## 步骤\n1. 打开\n2. 关闭')).toBe(
      '## 步骤\n1. 打开\n2. 关闭',
    );
  });

  it('keeps already-split backtick bullet lists', () => {
    const ok = ['文件夹：', '- `checkpoints`', '- `vae`'].join('\n');
    expect(reflowCollapsedMarkdownBlocks(ok)).toBe(ok);
  });

  it('splits ordered lists that trail a heading on the same line', () => {
    const src =
      '## ⚡ 快速操作步骤 1. 打开资源管理器 2. **新建文件夹** 3. 放入模型';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/^## ⚡ 快速操作步骤$/m);
    expect(out).toMatch(/^1\. 打开资源管理器$/m);
    expect(out).toMatch(/^2\. \*\*新建文件夹\*\*$/m);
    expect(out).toMatch(/^3\. 放入模型$/m);
  });

  it('keeps splitting ordered items after the first break (no \\s newline stall)', () => {
    const src =
      '3. 解压 ZIP 文件 4. 将解压后的文件夹**重命名为** `ComfyUI-Manager` 5. 放入 `D:\\x` 目录';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/^3\. 解压 ZIP 文件$/m);
    expect(out).toMatch(/^4\. 将解压后的文件夹\*\*重命名为\*\* `ComfyUI-Manager`$/m);
    expect(out).toMatch(/^5\. 放入 `D:\\x` 目录$/m);
  });

  it('joins ordered list marker line with following year paragraph', () => {
    const src =
      '1.\n\n**2025年2月26日：** 正式开始计费\n- 此前为限时免费阶段\n';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/^1\. \*\*2025年2月26日：\*\*/m);
  });

  it('also joins when the export uses fullwidth spaces (　)', () => {
    const src =
      '1.　\n\n2025年9月10日： 取消优惠时段（腾讯云平台）\n- 半价\n';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/^1\. 2025年9月10日：/m);
  });

  it('does not split figure captions inside an ordered item', () => {
    const src = '1. 先做这一步。见图 1. 然后继续。\n2. 第二步';
    expect(reflowCollapsedMarkdownBlocks(src)).toBe(src);
  });

  it('peels smashed heading body openers without breaking 适合你 titles', () => {
    expect(
      reflowCollapsedMarkdownBlocks(
        '## 💡 小提示 如果你下载了 **ComfyUI-Manager** 插件，它可以自动创建文件夹。',
      ),
    ).toMatch(/^## 💡 小提示\n\n如果你下载了/);
    expect(
      reflowCollapsedMarkdownBlocks(
        '## 🛠️ 需要手动创建的文件夹 进入 `D:\\models\\`，如果里面是空的。',
      ),
    ).toMatch(/^## 🛠️ 需要手动创建的文件夹\n\n进入 `/);
    expect(
      reflowCollapsedMarkdownBlocks('## 💡 为什么只有源码？ 因为插件就是脚本。'),
    ).toMatch(/^## 💡 为什么只有源码？\n\n因为插件就是脚本。/);
    expect(
      reflowCollapsedMarkdownBlocks('## 💡 总结 **Manager 的价值不在于下载**'),
    ).toMatch(/^## 💡 总结\n\n\*\*Manager 的价值不在于下载\*\*/);
    expect(reflowCollapsedMarkdownBlocks('## 适合你的方案')).toBe(
      '## 适合你的方案',
    );
  });

  it('splits backtick bullets after a colon', () => {
    const src =
      '创建以下文件夹： - `checkpoints` - `clip_vision` - `vae`';
    const out = reflowCollapsedMarkdownBlocks(src);
    expect(out).toMatch(/文件夹：\n- `checkpoints`/);
    expect(out).toMatch(/^-\s+`clip_vision`$/m);
    expect(out).toMatch(/^-\s+`vae`$/m);
  });
});
