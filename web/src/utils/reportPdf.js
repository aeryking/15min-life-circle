/**
 * 体检报告直接导出为 PDF 文件（不经过浏览器打印对话框）。
 *
 * 做法：把报告纸张按固定宽度渲染为高清位图，再按 A4 分页写入 PDF。
 * 分页时避开不可切分的单元（标题及其后的首段内容、表格行、列表项、示意图等）：
 * 理想切点落在某个单元内部时，把切点上移到该单元顶部；单元本身超过一页时才允许切开。
 * 两个库体积较大，点击导出时才按需加载，不影响首页加载速度。
 */

/** 不可切分的单元 */
const KEEP = 'header, .keep, tr, li, .dim, p, h2, footer';
/** 标题与其后内容的「粘连」高度（CSS 像素），避免标题孤零零留在页尾 */
const HEADING_TAIL = 72;
/** 导出时的排版宽度（CSS 像素）：放入 A4 可用宽度后，13px 正文约为 9 磅 */
const RENDER_WIDTH = 760;

const A4 = { w: 210, h: 297 };
const MARGIN = 12; // mm
const FOOTER = 6; // 页码区高度，mm

export async function exportReportPdf(paper, { filename }) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);

  paper.classList.add('pdf-mode');
  paper.style.width = `${RENDER_WIDTH}px`;
  try {
    // 等待按导出宽度重新排版后再测量
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const origin = paper.getBoundingClientRect();
    const blocks = [...paper.querySelectorAll(KEEP)]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top - origin.top, bottom: b.bottom - origin.top + (el.tagName === 'H2' ? HEADING_TAIL : 0) };
      })
      .filter((b) => b.bottom > b.top);

    const scale = Math.min(2.5, Math.max(2, window.devicePixelRatio || 1));
    const canvas = await html2canvas(paper, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true });
    const totalH = canvas.height / scale;
    const contentW = A4.w - 2 * MARGIN;
    const contentH = A4.h - 2 * MARGIN - FOOTER;
    const pxPerMm = canvas.width / scale / contentW;
    const pageH = contentH * pxPerMm;

    const pages = paginate(totalH, pageH, blocks);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ creator: 'Life Circle Checkup' });
    pages.forEach(([y0, y1], i) => {
      if (i) pdf.addPage();
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.ceil((y1 - y0) * scale);
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.floor(y0 * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, contentW, (y1 - y0) / pxPerMm, undefined, 'FAST');
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(`${i + 1} / ${pages.length}`, A4.w / 2, A4.h - MARGIN / 2, { align: 'center' });
    });
    pdf.save(filename);
    return { pages: pages.length };
  } finally {
    paper.classList.remove('pdf-mode');
    paper.style.width = '';
  }
}

/**
 * 计算分页区间 [起点, 终点)（CSS 像素）。
 * 切点落在某个单元内部时上移到该单元顶部（反复进行，直到不再穿过任何单元）；
 * 上移后本页不足 30% 页高的，说明该单元本身过高，此时直接在理想位置切开。
 */
export function paginate(totalH, pageH, blocks) {
  const pages = [];
  let y = 0;
  while (y < totalH - 1) {
    let end = Math.min(y + pageH, totalH);
    if (end < totalH) {
      const minEnd = y + pageH * 0.3;
      for (let moved = true; moved;) {
        moved = false;
        for (const b of blocks) {
          if (b.top < end - 0.5 && b.bottom > end + 0.5 && b.top >= minEnd) {
            end = b.top;
            moved = true;
          }
        }
      }
    }
    pages.push([y, end]);
    y = end;
  }
  return pages;
}
