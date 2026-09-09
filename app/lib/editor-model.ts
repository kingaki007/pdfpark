import type { TextLine } from './text-lines';
export type Mark = {
  id: string; kind: 'text' | 'image' | 'rectangle' | 'ellipse';
  x: number; y: number; width: number; height: number;
  text?: string; data?: string; color: string; fontSize: number; stroke: number;
  lines?: TextLine[]; fontFamily?: string; bold?: boolean; italic?: boolean;
  sourceBlockId?: string;
  sourceRect?: { x: number; y: number; width: number; height: number };
  background?: string;
};
export type EditorPage = {
  id: string; sourceId: string; sourceIndex: number;
  width: number; height: number; rotation: number; marks: Mark[];
};
export type DocumentState = { name: string; pages: EditorPage[] };
export type History = { past: DocumentState[]; present: DocumentState; future: DocumentState[] };
export const emptyDocument: DocumentState = { name: 'Untitled', pages: [] };
export function commit(history: History, next: DocumentState): History {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past.slice(-49), history.present], present: next, future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
export function movePage(pages: EditorPage[], id: string, delta: number): EditorPage[] {
  const from = pages.findIndex(p => p.id === id), to = from + delta;
  if (from < 0 || to < 0 || to >= pages.length) return pages;
  const result = [...pages]; result.splice(to, 0, result.splice(from, 1)[0]); return result;
}
export function displaySize(page: Pick<EditorPage, 'width' | 'height' | 'rotation'>) {
  return page.rotation % 180 ? { width: page.height, height: page.width } : { width: page.width, height: page.height };
}
export function toPagePoint(x: number, y: number, page: Pick<EditorPage, 'width' | 'height' | 'rotation'>) {
  switch (page.rotation) {
    case 90: return { x: y, y: page.height - x };
    case 180: return { x: page.width - x, y: page.height - y };
    case 270: return { x: page.width - y, y: x };
    default: return { x, y };
  }
}
export function rotationTransform(page: Pick<EditorPage, 'width' | 'height' | 'rotation'>) {
  switch (page.rotation) {
    case 90: return `translate(${page.height} 0) rotate(90)`;
    case 180: return `translate(${page.width} ${page.height}) rotate(180)`;
    case 270: return `translate(0 ${page.width}) rotate(270)`;
    default: return '';
  }
}
export function fitMark(mark: Mark, page: EditorPage): Mark {
  const width = Math.min(page.width, Math.max(8, mark.width));
  const height = Math.min(page.height, Math.max(8, mark.height));
  return { ...mark, width, height, x: Math.max(0, Math.min(page.width - width, mark.x)), y: Math.max(0, Math.min(page.height - height, mark.y)) };
}
export function parsePageRange(value: string, count: number): number[] {
  if (!value.trim()) return Array.from({ length: count }, (_, i) => i);
  const result = new Set<number>();
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers or ranges, for example 1, 3-5.');
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`Choose pages between 1 and ${count}.`);
    for (let n = start; n <= end; n++) result.add(n - 1);
  }
  return [...result].sort((a, b) => a - b);
}
