import type { Mark } from "./editor-model";
export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
};
export type TextRun = { text: string; style: TextStyle };
export type TextLine = { runs: TextRun[]; indent: number; leading: number };
export const fontFamilies = [
  "Arial",
  "Times New Roman",
  "Courier New",
  "Georgia",
  "Verdana",
] as const;
export function defaultStyle(mark: Mark): TextStyle {
  return {
    fontFamily: mark.fontFamily || "Arial",
    fontSize: mark.fontSize,
    bold: mark.bold || false,
    italic: mark.italic || false,
    color: mark.color,
  };
}
export function getLines(mark: Mark): TextLine[] {
  return (
    mark.lines ??
    (mark.text || "")
      .split("\n")
      .map((text) => ({
        runs: [{ text, style: defaultStyle(mark) }],
        indent: 0,
        leading: mark.fontSize * 1.2,
      }))
  );
}
export function lineText(line: TextLine) {
  return line.runs.map((run) => run.text).join("");
}
export function lineSize(line: TextLine) {
  return Math.max(6, ...line.runs.map((run) => run.style.fontSize));
}
export function textHeight(lines: TextLine[]) {
  return lines.reduce((sum, line) => sum + Math.max(line.leading, lineSize(line)), 0);
}
export function withLines(mark: Mark, lines: TextLine[]): Mark {
  return {
    ...mark,
    lines,
    text: lines.map(lineText).join("\n"),
    height: Math.max(8, textHeight(lines)),
  };
}
export function replaceLineText(line: TextLine, text: string): TextLine {
  const old = lineText(line);
  let start = 0,
    end = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start++;
  while (
    end < old.length - start &&
    end < text.length - start &&
    old[old.length - 1 - end] === text[text.length - 1 - end]
  )
    end++;
  const chars = line.runs.flatMap((run) =>
    run.text.split("").map((char) => ({ char, style: run.style })),
  );
  const style = chars[Math.max(0, start - 1)]?.style ?? line.runs[0].style;
  const next = [
    ...chars.slice(0, start),
    ...text
      .slice(start, text.length - end)
      .split("")
      .map((char) => ({ char, style })),
    ...(end ? chars.slice(-end) : []),
  ];
  const runs: TextRun[] = [];
  for (const entry of next) {
    const last = runs.at(-1);
    if (last && JSON.stringify(last.style) === JSON.stringify(entry.style)) last.text += entry.char;
    else runs.push({ text: entry.char, style: { ...entry.style } });
  }
  return { ...line, runs: runs.length ? runs : [{ text: "", style: { ...style } }] };
}
export function insertLine(lines: TextLine[], index: number, after = true): TextLine[] {
  const reference = lines[index];
  const whitespace = lineText(reference).match(/^[\t ]*/)?.[0] || "";
  const added = {
    ...reference,
    runs: [{ text: whitespace, style: { ...reference.runs[0].style } }],
  };
  return [...lines.slice(0, index + Number(after)), added, ...lines.slice(index + Number(after))];
}
export function canvasFont(style: TextStyle) {
  return (
    (style.italic ? "italic " : "") +
    (style.bold ? "bold " : "") +
    style.fontSize +
    'px "' +
    style.fontFamily +
    '"'
  );
}
export function expandTabs(text: string) {
  return text.replace(/\t/g, "    ");
}
