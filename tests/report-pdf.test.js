import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../web/src/utils/reportPdf.js';

const covers = (pages, total) => pages[0][0] === 0 && pages.at(-1)[1] === total && pages.every((p, i) => !i || p[0] === pages[i - 1][1]);

test('PDF 分页：切点不穿过不可切分的单元，页面首尾相接、覆盖全文', () => {
  // 页高 1000；第一页理想切点 1000 落在 [950, 1080) 的表格行内 → 上移到 950
  const blocks = [
    { top: 0, bottom: 300 },
    { top: 950, bottom: 1080 },
    { top: 1880, bottom: 1990 },
  ];
  const pages = paginate(2600, 1000, blocks);
  assert.deepEqual(pages[0], [0, 950]);
  assert.deepEqual(pages[1], [950, 1880], '第二页的理想切点 1950 落在 [1880, 1990) 内，上移到 1880');
  assert.ok(covers(pages, 2600));
  for (const [, end] of pages.slice(0, -1)) for (const b of blocks) assert.ok(!(b.top < end && b.bottom > end), `切点 ${end} 穿过了单元`);
});

test('PDF 分页：嵌套单元连续上移；单元超过一页时才在理想位置切开', () => {
  // 切点 1000 先落在行 [900,1100)，上移到 900 又落在另一单元 [850,950) → 最终 850
  assert.deepEqual(
    paginate(1500, 1000, [
      { top: 900, bottom: 1100 },
      { top: 850, bottom: 950 },
    ])[0],
    [0, 850],
  );
  // 单元 [100, 2500) 比一页还高：上移会让本页不足 30%，直接按页高切开
  const pages = paginate(2500, 1000, [{ top: 100, bottom: 2500 }]);
  assert.deepEqual(pages[0], [0, 1000]);
  assert.ok(covers(pages, 2500));
});
