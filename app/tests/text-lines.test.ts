import { describe, it, expect } from "vitest";
import {
  getLines,
  insertLine,
  lineText,
  replaceLineText,
  withLines,
  type TextLine,
  type TextStyle,
} from "../lib/text-lines";
import { groupTextBlocks } from "../lib/text-extraction";
import { commit, undo, redo, type Mark, type EditorPage } from "../lib/editor-model";
const style: TextStyle = {
  fontFamily: "Courier New",
  fontSize: 12,
  bold: true,
  italic: false,
  color: "#123456",
};
const line: TextLine = {
  indent: 24,
  leading: 18,
  runs: [
    { text: "  First ", style },
    { text: "second", style: { ...style, italic: true, color: "#ff0000" } },
  ],
};
const mark: Mark = {
  id: "m",
  kind: "text",
  x: 30,
  y: 40,
  width: 200,
  height: 36,
  fontSize: 12,
  stroke: 0,
  color: "#123456",
  lines: [line, { ...line, runs: [{ text: "Last", style }] }],
};
const page: EditorPage = {
  id: "p",
  sourceId: "s",
  sourceIndex: 0,
  width: 600,
  height: 800,
  rotation: 0,
  marks: [mark],
};
describe("formatted text lines", () => {
  it("inserts above and below with copied indentation, whitespace, font, color and spacing", () => {
    const original = getLines(mark);
    const below = insertLine(original, 0);
    expect(below).toHaveLength(3);
    expect(below[1]).toEqual({ indent: 24, leading: 18, runs: [{ text: "  ", style }] });
    expect(below[1].runs[0].style).not.toBe(style);
    expect(below[0]).toBe(original[0]);
    expect(below[2]).toBe(original[1]);
    expect(insertLine(original, 0, false)[1]).toBe(original[0]);
  });
  it("preserves mixed formatting before and after a text edit", () => {
    const next = replaceLineText(line, "  First new second");
    expect(lineText(next)).toBe("  First new second");
    expect(next.runs.at(-1)?.style).toEqual(line.runs[1].style);
    expect(next.runs[0].style).toEqual(style);
    expect(lineText(line)).toBe("  First second");
  });
  it("retains style when clearing a line and typing again", () => {
    const empty = replaceLineText(line, "");
    expect(replaceLineText(empty, "New").runs).toEqual([{ text: "New", style }]);
  });
  it("shrinks content after removal, keeps the original cover, and supports undo/redo", () => {
    const original = { ...mark, sourceRect: { x: 30, y: 40, width: 200, height: 40 } };
    const removed = withLines(original, getLines(original).slice(1));
    expect(removed.height).toBe(18);
    expect(removed.sourceRect).toEqual(original.sourceRect);
    const document = { name: "test", pages: [{ ...page, marks: [original] }] };
    const history = commit(
      { past: [], present: document, future: [] },
      { ...document, pages: [{ ...page, marks: [removed] }] },
    );
    expect(undo(history).present).toEqual(document);
    expect(redo(undo(history)).present.pages[0].marks[0]).toEqual(removed);
    expect(withLines(original, []).lines).toEqual([]);
  });
  it("keeps old text boxes editable with preserved whitespace", () => {
    expect(getLines({ ...mark, lines: undefined, text: "  one\n\ttwo" }).map(lineText)).toEqual([
      "  one",
      "\ttwo",
    ]);
  });
});
it("groups paragraphs while keeping columns separate and mixed styles intact", () => {
  const blocks = groupTextBlocks(
    [
      { text: "Hello", x: 40, baseline: 60, width: 30, style },
      { text: "world", x: 74, baseline: 60, width: 30, style: { ...style, italic: true } },
      { text: "Indented", x: 52, baseline: 78, width: 70, style },
      { text: "Other column", x: 320, baseline: 60, width: 100, style },
      { text: "Next row", x: 320, baseline: 78, width: 80, style },
    ],
    page,
  );
  expect(blocks).toHaveLength(2);
  expect(blocks[0].lines).toHaveLength(2);
  expect(blocks[0].lines![1].indent - blocks[0].lines![0].indent).toBe(12);
  expect(blocks[0].lines![0].runs.at(-1)?.style.italic).toBe(true);
  expect(blocks[0].sourceRect?.height).toBeCloseTo(33.6);
  expect(blocks[1].x).toBe(319);
});
