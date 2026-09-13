import { PDFDocument, degrees } from "pdf-lib";
import type { EditorPage } from "./editor-model";

// The overlay is expressed in the unrotated PDF.js viewport. Map its bottom-left
// back into the original PDF coordinate system, including nonzero crop origins.
export function overlayPlacement(
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
) {
  const r = ((rotation % 360) + 360) % 360;
  const { x, y, width: w, height: h } = crop;
  return {
    x: x + (r === 90 || r === 180 ? w : 0),
    y: y + (r === 180 || r === 270 ? h : 0),
    width: r % 180 ? h : w,
    height: r % 180 ? w : h,
    rotate: degrees(r),
  };
}

export async function assemblePdf(
  pages: EditorPage[],
  getBytes: (id: string) => Uint8Array,
  getOverlay: (page: EditorPage) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  if (!pages.length) throw new Error("Select at least one page to export.");
  const output = await PDFDocument.create();
  const loaded = new Map<string, PDFDocument>();
  for (const page of pages) {
    if (page.marks.some((mark) => mark.sourceRect)) {
      const raster = await getOverlay(page);
      if (!raster) throw new Error("The edited page image is missing.");
      const flattened = output.addPage([page.width, page.height]);
      flattened.drawImage(await output.embedPng(raster), {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      });
      flattened.setRotation(degrees(page.rotation));
      continue;
    }
    let source = loaded.get(page.sourceId);
    if (!source) {
      source = await PDFDocument.load(getBytes(page.sourceId));
      loaded.set(page.sourceId, source);
    }
    const [copy] = await output.copyPages(source, [page.sourceIndex]);
    const originalRotation = copy.getRotation().angle;
    const overlay = await getOverlay(page);
    if (overlay)
      copy.drawImage(
        await output.embedPng(overlay),
        overlayPlacement(copy.getCropBox(), originalRotation),
      );
    copy.setRotation(degrees((originalRotation + page.rotation) % 360));
    output.addPage(copy);
  }
  output.setProducer("PDF Park");
  return output.save();
}
