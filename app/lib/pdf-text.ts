import { Util } from "pdfjs-dist";
import { sources } from "./pdf-engine";
import type { EditorPage, Mark } from "./editor-model";
import { groupTextBlocks, type ExtractedItem } from "./text-extraction";
export async function extractTextBlocks(page: EditorPage): Promise<Mark[]> {
  const source = sources.get(page.sourceId);
  if (!source) throw new Error("Reopen the PDF to edit its text.");
  const pdfPage = await source.document.getPage(page.sourceIndex + 1);
  const content = await pdfPage.getTextContent();
  const viewport = pdfPage.getViewport({ scale: 1 });
  // Sample page colors locally, without uploading document content.
  const scale = Math.min(2, 4096 / Math.max(page.width, page.height));
  const canvas = document.createElement("canvas");
  const view = pdfPage.getViewport({ scale });
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  await pdfPage.render({ canvas, viewport: view }).promise;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const items: ExtractedItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim() || item.dir !== "ltr") continue;
    const matrix = Util.transform(viewport.transform, item.transform);
    // Arbitrary rotated/skewed text needs a different editing coordinate system.
    if (Math.abs(matrix[1]) > 0.01 || Math.abs(matrix[2]) > 0.01 || matrix[0] <= 0) continue;
    const size = Math.hypot(matrix[2], matrix[3]);
    if (size < 1) continue;
    let name = content.styles[item.fontName]?.fontFamily || "";
    if (pdfPage.commonObjs.has(item.fontName))
      name += " " + (pdfPage.commonObjs.get(item.fontName)?.name || "");
    const family = /courier|mono/i.test(name)
      ? "Courier New"
      : /times|serif/i.test(name) && !/sans/i.test(name)
        ? "Times New Roman"
        : "Arial";
    items.push({
      text: item.str,
      x: matrix[4],
      baseline: matrix[5],
      width: item.width,
      style: {
        fontFamily: family,
        fontSize: size,
        bold: /bold|black|heavy/i.test(name),
        italic: /italic|oblique/i.test(name),
        color: "#000000",
      },
    });
  }
  const blocks = groupTextBlocks(items, page);
  if (!blocks.length) {
    canvas.width = canvas.height = 0;
    return blocks;
  }
  const hex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  for (const block of blocks) {
    const r = block.sourceRect!;
    const x = Math.max(0, Math.floor(r.x * scale)),
      y = Math.max(0, Math.floor(r.y * scale));
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(r.width * scale))),
      h = Math.max(1, Math.min(canvas.height - y, Math.ceil(r.height * scale)));
    if (x >= canvas.width || y >= canvas.height) continue;
    const pixels = ctx.getImageData(x, y, w, h).data;
    const colors = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const c = hex(pixels[i], pixels[i + 1], pixels[i + 2]);
      colors.set(c, (colors.get(c) || 0) + 1);
    }
    block.background = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] || "#ffffff";
    // Choose the strongest ink color in each run's approximate rectangle.
    let top = block.y;
    for (const line of block.lines!) {
      let left = block.x + line.indent;
      for (const run of line.runs) {
        ctx.font = run.style.fontSize * scale + 'px "' + run.style.fontFamily + '"';
        const width = ctx.measureText(run.text).width;
        const rx = Math.max(0, Math.floor(left * scale)),
          ry = Math.max(0, Math.floor(top * scale));
        const rw = Math.max(1, Math.min(canvas.width - rx, Math.ceil(width))),
          rh = Math.max(
            1,
            Math.min(canvas.height - ry, Math.ceil(run.style.fontSize * 1.2 * scale)),
          );
        if (rx < canvas.width && ry < canvas.height && run.text.trim()) {
          const data = ctx.getImageData(rx, ry, rw, rh).data;
          const bg = block.background.match(/\w\w/g)!.map((v) => parseInt(v, 16));
          let distance = 0,
            ink = "#000000";
          for (let i = 0; i < data.length; i += 4) {
            const d =
              Math.abs(data[i] - bg[0]) +
              Math.abs(data[i + 1] - bg[1]) +
              Math.abs(data[i + 2] - bg[2]);
            if (d > distance) {
              distance = d;
              ink = hex(data[i], data[i + 1], data[i + 2]);
            }
          }
          run.style = { ...run.style, color: ink };
        }
        left += width / scale;
      }
      top += line.leading;
    }
  }
  canvas.width = canvas.height = 0;
  return blocks;
}
