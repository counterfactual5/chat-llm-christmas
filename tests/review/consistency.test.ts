import { describe, expect, it } from 'vitest';
import { buildConsistencyCheck } from '@/lib/tools/review/checks/consistency';

describe('buildConsistencyCheck', () => {
  it('flags same-metric conflict in continuous prose', () => {
    const padding = '中间说明文字。'.repeat(40);
    const text = [
      '根据测算，有效税率为 15。',
      padding,
      '在没有给出不同情景或表格行区分的情况下，有效税率为 22。',
      padding,
    ].join('');
    const check = buildConsistencyCheck(text);
    expect(check?.clean).toBe(false);
    expect(check?.items?.[0]?.title).toMatch(/有效税率/);
  });

  it('does not flag Size labels on different numbered book list items', () => {
    const text = `
### Books

Query: blockchain

1. [区块链](https://libgen.li/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
   - 长铗 · 2016 · epub · 6 MB
   - Download: \`/books download libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
   - Size: 6 MB

2. [区块链：从数字货币到信用社会](https://libgen.li/ads.php?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)
   - 2016 · epub · 3 MB
   - Download: \`/books download libgen:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`
   - Size: 3 MB

3. [Mastering Bitcoin](https://archive.org/details/masteringbitcoin0000anto)
   - Andreas M. Antonopoulos · 2014
   - Download: \`/books download masteringbitcoin0000anto\`
   - Size: 12 MB

提示：复制对应的 /books download 命令到输入框执行下载。
`.trim();
    const check = buildConsistencyCheck(text);
    expect(check?.clean ?? true).toBe(true);
    expect(check?.items?.some((i) => /size/i.test(i.title)) ?? false).toBe(false);
  });
});
