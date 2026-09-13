import { describe, expect, it } from "vitest";
import {
  commit,
  undo,
  redo,
  movePage,
  parsePageRange,
  toPagePoint,
  fitMark,
  type EditorPage,
} from "../lib/editor-model";
const page = (id: string): EditorPage => ({
  id,
  sourceId: "source",
  sourceIndex: 0,
  width: 600,
  height: 800,
  rotation: 0,
  marks: [],
});
describe("document operations", () => {
  it("keeps stable page identity and annotations when reordering", () => {
    const pages = [page("a"), page("b"), page("c")];
    const moved = movePage(pages, "b", 1);
    expect(moved.map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(moved[2]).toBe(pages[1]);
    expect(pages[1].id).toBe("b");
  });
  it("does not move past either document boundary", () => {
    const pages = [page("a"), page("b")];
    expect(movePage(pages, "a", -1)).toBe(pages);
    expect(movePage(pages, "b", 1)).toBe(pages);
  });
  it("undoes deletion, redoes it, and discards redo after another edit", () => {
    const original = { name: "test", pages: [page("a"), page("b")] };
    const deleted = commit(
      { past: [], present: original, future: [] },
      { ...original, pages: [original.pages[1]] },
    );
    const restored = undo(deleted);
    expect(restored.present).toEqual(original);
    expect(redo(restored).present.pages).toHaveLength(1);
    expect(commit(restored, { ...original, name: "changed" }).future).toHaveLength(0);
  });
  it("selects page ranges in document order without duplicates", () => {
    expect(parsePageRange("3-5, 1, 3", 5)).toEqual([0, 2, 3, 4]);
    expect(parsePageRange("", 2)).toEqual([0, 1]);
  });
  it.each(["0", "4", "2-1", "one", "1,", "-1"])("rejects invalid range %s", (range) =>
    expect(() => parsePageRange(range, 3)).toThrow(),
  );
  it.each([
    [0, 100, 200],
    [90, 600, 100],
    [180, 500, 600],
    [270, 200, 500],
  ])("maps a displayed point back through rotation %s", (rotation, x, y) => {
    expect(toPagePoint(x, y, { width: 600, height: 800, rotation })).toEqual({ x: 100, y: 200 });
  });
  it("constrains edited objects to the page without negative sizes", () => {
    const m = fitMark(
      {
        id: "m",
        kind: "text",
        x: -20,
        y: 900,
        width: 900,
        height: -1,
        color: "#000000",
        fontSize: 20,
        stroke: 2,
      },
      page("a"),
    );
    expect(m).toMatchObject({ x: 0, y: 792, width: 600, height: 8 });
  });
});
