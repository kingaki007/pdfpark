import { zipSync, strToU8 } from 'fflate';
import { api } from './server-api';
export type ToolResult = {
  bytes: Uint8Array;
  type: string;
  extension: string;
  report?: unknown;
};
export async function runTool(
  id: string,
  files: File[],
  options: Record<string, unknown> = {},
): Promise<ToolResult> {
  if (files.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024)
    throw new Error('The combined upload must be smaller than 40 MB.');
  const entries: Record<string, Uint8Array> = {
    'options.json': strToU8(
      JSON.stringify({ options, files: files.map((f) => ({ name: f.name })) }),
    ),
  };
  for (let i = 0; i < files.length; i++)
    entries['file-' + i] = new Uint8Array(await files[i].arrayBuffer());
  const archive = zipSync(entries, { level: 0 });
  const response = await api('/tools/' + id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: new Blob([archive.slice().buffer]),
  });
  const type =
    response.headers.get('Content-Type') || 'application/octet-stream';
  const extension =
    /filename="result\.([a-z0-9]+)"/.exec(
      response.headers.get('Content-Disposition') || '',
    )?.[1] || 'pdf';
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    type,
    extension,
    report: type.includes('application/json')
      ? JSON.parse(new TextDecoder().decode(bytes))
      : undefined,
  };
}
export function saveResult(result: ToolResult, name: string) {
  const url = URL.createObjectURL(
    new Blob([result.bytes.slice().buffer], { type: result.type }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.' + result.extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function localText(file: File) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    cMapUrl: '/pdf-assets/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/',
    wasmUrl: '/pdf-assets/wasm/',
  }).promise;
  try {
    if (pdf.numPages > 200)
      throw new Error('Choose a PDF with up to 200 pages.');
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const c = await p.getTextContent();
      texts.push(
        c.items
          .map((t) =>
            'str' in t ? t.str + ('hasEOL' in t && t.hasEOL ? '\n' : ' ') : '',
          )
          .join(''),
      );
    }
    return texts;
  } finally {
    await pdf.destroy();
  }
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
