import { expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { assemblePdf, overlayPlacement } from '../lib/pdf-export';
import type { EditorPage } from '../lib/editor-model';
it('merges, selects, reorders and rotates actual PDF pages without changing originals', async () => {
  const a = await PDFDocument.create(); a.addPage([200, 300]); a.addPage([400, 500]);
  const b = await PDFDocument.create(); b.addPage([600, 700]).setRotation(degrees(90));
  const sources = { a: await a.save(), b: await b.save() };
  const pages: EditorPage[] = [{ id: 'b0', sourceId: 'b', sourceIndex: 0, width: 700, height: 600, rotation: 90, marks: [] }, { id: 'a1', sourceId: 'a', sourceIndex: 1, width: 400, height: 500, rotation: 0, marks: [] }];
  const output = await PDFDocument.load(await assemblePdf(pages, id => sources[id as keyof typeof sources], async () => null));
  expect(output.getPageCount()).toBe(2); expect(output.getPage(0).getSize()).toEqual({ width: 600, height: 700 });
  expect(output.getPage(0).getRotation().angle).toBe(180); expect(output.getPage(1).getWidth()).toBe(400);
  expect((await PDFDocument.load(sources.b)).getPage(0).getRotation().angle).toBe(90);
});
it.each([[0, 10, 20, 200, 300], [90, 210, 20, 300, 200], [180, 210, 320, 200, 300], [270, 10, 320, 300, 200]])('aligns overlays with crop origins and intrinsic rotation %s', (r, x, y, width, height) => {
  expect(overlayPlacement({ x: 10, y: 20, width: 200, height: 300 }, r)).toEqual({ x, y, width, height, rotate: degrees(r) });
});
it('embeds an overlay into a copied PDF page', async () => {
  const doc = await PDFDocument.create(); doc.addPage([200, 300]); const bytes = await doc.save();
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const page: EditorPage = { id: '1', sourceId: 's', sourceIndex: 0, width: 200, height: 300, rotation: 0, marks: [] };
  const output = await PDFDocument.load(await assemblePdf([page], () => bytes, async () => png));
  expect(output.getPage(0).node.Resources()?.toString()).toContain('Image');
});
it('rejects empty exports', async () => { await expect(assemblePdf([], () => new Uint8Array(), async () => null)).rejects.toThrow('Select at least one page'); });

it.each([0, 90, 180, 270])('exports edited original text as a fresh image page at rotation %s', async rotation => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const page: EditorPage = { id: 'edited', sourceId: 's', sourceIndex: 0, width: 300, height: 200, rotation, marks: [{ id: 'm', kind: 'text', x: 10, y: 10, width: 80, height: 20, text: '', lines: [], color: '#000000', fontSize: 12, stroke: 0, sourceRect: { x: 10, y: 10, width: 80, height: 20 } }] };
  const output = await PDFDocument.load(await assemblePdf([page], () => { throw new Error('Original content must not be copied'); }, async () => png));
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getSize()).toEqual({ width: 300, height: 200 });
  expect(output.getPage(0).getRotation().angle).toBe(rotation);
  expect(output.getPage(0).node.Resources()?.toString()).toContain('Image');
  await expect(assemblePdf([page], () => new Uint8Array(), async () => null)).rejects.toThrow('edited page image is missing');
});
