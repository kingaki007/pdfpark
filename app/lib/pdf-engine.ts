import { canvasFont, expandTabs, getLines, lineSize } from './text-lines';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import type { EditorPage, Mark } from './editor-model';

// The worker bytes did not change with the Nginx MIME fix. Change its URL too,
// so browsers cannot reuse the previously cached application/octet-stream response.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl + (workerUrl.includes('?') ? '&' : '?') + 'worker-mime=js-v2';
export const MAX_FILE_SIZE = 40 * 1024 * 1024;
export const MAX_PAGES = 200;
export type Source = { bytes: Uint8Array; document: pdfjs.PDFDocumentProxy };
export const sources = new Map<string, Source>();
const options = { cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', isEvalSupported: false };

export async function importPdf(bytes: Uint8Array): Promise<EditorPage[]> {
  if (bytes.length > MAX_FILE_SIZE) throw new Error('This file exceeds the 40 MB limit. Split or compress it first.');
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('This is not a supported PDF file. Choose a PDF, PNG, or JPEG.');
  let document: pdfjs.PDFDocumentProxy | undefined;
  try {
    const editable = await PDFDocument.load(bytes);
    // Copying interactive forms without a field tree can silently lose values.
    // Reject them explicitly until a tested form-flattening workflow is added.
    if (editable.getForm().getFields().length) throw new Error('Interactive or signed forms are not supported yet. Flatten a copy in your PDF viewer, then import it.');
    document = await pdfjs.getDocument({ data: bytes.slice(), ...options }).promise;
    if (document.numPages > MAX_PAGES) throw new Error(`This PDF exceeds the ${MAX_PAGES}-page limit. Split it into smaller documents.`);
    const sourceId = crypto.randomUUID(), pages: EditorPage[] = [];
    for (let i = 0; i < document.numPages; i++) {
      const p = await document.getPage(i + 1), view = p.getViewport({ scale: 1 });
      if (view.width > 14400 || view.height > 14400) throw new Error('This PDF contains a page larger than the supported size.');
      pages.push({ id: crypto.randomUUID(), sourceId, sourceIndex: i, width: view.width, height: view.height, rotation: 0, marks: [] });
    }
    sources.set(sourceId, { bytes, document }); return pages;
  } catch (error) {
    await document?.destroy().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    if (/worker|dynamically imported module|module script|fetch/i.test(message)) throw new Error('The PDF rendering worker could not load. Refresh the app. If this continues, check that the server serves .mjs files as application/javascript.');
    if (/password|encrypt/i.test(message)) throw new Error('This PDF is encrypted or password-protected. Use Unlock PDF in the header to enter its password and download an unlocked copy, then open that copy.');
    if (/limit|exceeds|not supported|supported size/i.test(message)) throw error;
    throw new Error('This PDF is damaged or uses an unsupported structure. Try opening and saving a fresh copy in a PDF viewer.');
  }
}
export async function imageData(file: File): Promise<string> {
  if (file.size > MAX_FILE_SIZE) throw new Error('Images must be smaller than 40 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error('Unsupported image. Choose a PNG or JPEG file.');
  const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
  const img = await loadImage(data);
  if (img.naturalWidth * img.naturalHeight > 24_000_000) throw new Error('This image exceeds 24 megapixels. Resize it before importing.');
  return data;
}
export async function imagesToPdf(files: File[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const data = await imageData(file);
    const image = data.startsWith('data:image/png') ? await pdf.embedPng(data) : await pdf.embedJpg(data);
    const ratio = Math.min(1, 1440 / Math.max(image.width, image.height));
    const page = pdf.addPage([image.width * ratio, image.height * ratio]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return pdf.save();
}
export function loadImage(data: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('The image could not be decoded. Choose another PNG or JPEG.')); image.src = data; });
}
export function markTextLines(mark: Mark): string[] { return (mark.text || '').split('\n'); }
export async function overlayPng(page: EditorPage): Promise<Uint8Array | null> {
  if (!page.marks.length) return null;
  const scale = Math.min(2, 4096 / Math.max(page.width, page.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(page.width * scale); canvas.height = Math.ceil(page.height * scale);
  const ctx = canvas.getContext('2d')!; ctx.scale(scale, scale);
  for (const m of page.marks) { if (m.sourceRect) { ctx.fillStyle = m.background || '#ffffff'; const r = m.sourceRect; ctx.fillRect(r.x, r.y, r.width, r.height); } }
  for (const m of page.marks) {
    ctx.save(); ctx.beginPath(); ctx.rect(m.x, m.y, m.width, m.height); ctx.clip();
    ctx.fillStyle = m.color; ctx.strokeStyle = m.color; ctx.lineWidth = m.stroke;
    if (m.kind === 'text') {
      ctx.textBaseline = 'alphabetic'; let top = m.y;
      for (const line of getLines(m)) {
        let x = m.x + line.indent;
        for (const run of line.runs) { ctx.font = canvasFont(run.style); ctx.fillStyle = run.style.color; const text = expandTabs(run.text); ctx.fillText(text, x, top + lineSize(line)); x += ctx.measureText(text).width; }
        top += Math.max(line.leading, lineSize(line));
      }
    } else if (m.kind === 'image' && m.data) ctx.drawImage(await loadImage(m.data), m.x, m.y, m.width, m.height);
    else if (m.kind === 'rectangle') ctx.strokeRect(m.x + m.stroke / 2, m.y + m.stroke / 2, m.width - m.stroke, m.height - m.stroke);
    else if (m.kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(m.x + m.width / 2, m.y + m.height / 2, Math.max(1, (m.width - m.stroke) / 2), Math.max(1, (m.height - m.stroke) / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render the export.')), 'image/png'));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}
export async function exportPdf(pages: EditorPage[]) {
  const originals: Record<string, Uint8Array> = {}, overlays: Record<string, Uint8Array | null> = {};
  for (const page of pages) {
    const source = sources.get(page.sourceId);
    if (!source) throw new Error('The original file is no longer available. Reopen the PDF.');
    originals[page.sourceId] ??= source.bytes.slice();
    overlays[page.id] = await overlayPng(page);
    if (page.marks.some(mark => mark.sourceRect)) {
      const pdfPage = await source.document.getPage(page.sourceIndex + 1);
      const viewport = pdfPage.getViewport({ scale: Math.min(2, 4096 / Math.max(page.width, page.height)) });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await pdfPage.render({ canvas, viewport }).promise;
      const overlay = overlays[page.id];
      if (overlay) { const url = URL.createObjectURL(new Blob([overlay.slice().buffer as ArrayBuffer], { type: 'image/png' })); try { canvas.getContext('2d')!.drawImage(await loadImage(url), 0, 0, canvas.width, canvas.height); } finally { URL.revokeObjectURL(url); } }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not flatten edited text.')), 'image/png'));
      overlays[page.id] = new Uint8Array(await blob.arrayBuffer()); canvas.width = canvas.height = 0;
    }
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-export.worker.ts', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Export took too long. Try fewer pages.')); }, 120_000);
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = event => { finish(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.bytes); };
    worker.onerror = () => { finish(); reject(new Error('The export worker stopped. Try a smaller document.')); };
    worker.postMessage({ pages, sources: originals, overlays });
  });
}
export async function exportJpg(pages: EditorPage[], name: string) {
  const bytes = await exportPdf(pages);
  const doc = await pdfjs.getDocument({ data: bytes, ...options }).promise;
  const files: Record<string, Uint8Array> = {};
  try {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1), base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 4096 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('JPG export failed.')), 'image/jpeg', 0.92));
      files[`${name}-${i + 1}.jpg`] = new Uint8Array(await blob.arrayBuffer()); canvas.width = canvas.height = 0;
    }
  } finally { await doc.destroy(); }
  return pages.length === 1 ? { bytes: Object.values(files)[0], name: `${name}.jpg`, type: 'image/jpeg' } : { bytes: zipSync(files, { level: 0 }), name: `${name}-jpg.zip`, type: 'application/zip' };
}
export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function discardSourcesExcept(ids: Set<string>) {
  for (const [id, source] of sources) if (!ids.has(id)) { sources.delete(id); await source.document.destroy(); }
}



