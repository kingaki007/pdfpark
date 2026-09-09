import type { EditorPage, Mark } from './editor-model';
import type { TextLine, TextRun, TextStyle } from './text-lines';
export type ExtractedItem = { text: string; x: number; baseline: number; width: number; style: TextStyle };
export function groupTextBlocks(items: ExtractedItem[], page: EditorPage): Mark[] {
  const rows: { x: number; y: number; right: number; size: number; items: ExtractedItem[] }[] = [];
  for (const item of [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const row = rows.findLast(r => Math.abs(r.y - item.baseline) < Math.min(r.size, item.style.fontSize) * .25 && item.x >= r.x && item.x - r.right < r.size * 3);
    if (row) { row.items.push(item); row.right = Math.max(row.right, item.x + item.width); row.size = Math.max(row.size, item.style.fontSize); }
    else rows.push({ x: item.x, y: item.baseline, right: item.x + item.width, size: item.style.fontSize, items: [item] });
  }
  const blocks: typeof rows[] = [];
  for (const row of rows) {
    const block = blocks.findLast(b => { const last = b.at(-1)!; return row.y > last.y + last.size * .5 && row.y - last.y <= last.size * 1.8 && Math.abs(row.x - last.x) <= 24 && Math.abs(row.size - last.size) <= 2; });
    if (block) block.push(row); else blocks.push([row]);
  }
  return blocks.map((rows, index) => {
    const x = Math.max(0, Math.min(...rows.map(row => row.x)) - 1);
    const y = Math.max(0, rows[0].y - rows[0].size);
    const right = Math.min(page.width, Math.max(...rows.map(row => row.right)) + 2);
    const bottom = Math.min(page.height, rows.at(-1)!.y + rows.at(-1)!.size * .3);
    const lines: TextLine[] = rows.map((row, i) => {
      const runs: TextRun[] = [];
      let previousRight = row.x;
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        const gap = Math.max(0, item.x - previousRight);
        if (gap > item.style.fontSize * .15) runs.push({ text: ' '.repeat(Math.max(1, Math.round(gap / (item.style.fontSize * .3)))), style: item.style });
        runs.push({ text: item.text, style: item.style }); previousRight = item.x + item.width;
      }
      return { runs, indent: row.x - x, leading: rows[i + 1] ? rows[i + 1].y - row.y : row.size * 1.2 };
    });
    const id = page.id + '-text-' + index;
    return { id, kind: 'text', sourceBlockId: id, sourceRect: { x, y, width: right - x, height: bottom - y }, x, y, width: right - x, height: bottom - y, lines, text: lines.map(l => l.runs.map(r => r.text).join('')).join('\n'), fontSize: rows[0].size, color: lines[0].runs[0].style.color, stroke: 0, background: '#ffffff' };
  });
}
