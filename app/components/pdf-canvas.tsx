import { getLines, lineSize, expandTabs } from "@/lib/text-lines";
import { useEffect, useRef, useState } from "react";
import { sources } from "@/lib/pdf-engine";
import { displaySize, rotationTransform, type EditorPage } from "@/lib/editor-model";
export function PdfCanvas({
  page,
  scale,
  onError,
  thumbnail = false,
}: {
  page: EditorPage;
  scale: number;
  onError: (message: string) => void;
  thumbnail?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const size = displaySize(page);
  useEffect(() => {
    if (!thumbnail || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | undefined;
    const render = async () => {
      try {
        const source = sources.get(page.sourceId);
        if (!source) return;
        const pdfPage = await source.document.getPage(page.sourceIndex + 1);
        if (cancelled || !ref.current) return;
        const resolution = Math.min(
          scale * Math.min(window.devicePixelRatio || 1, 2),
          4096 / Math.max(size.width, size.height),
        );
        const viewport = pdfPage.getViewport({
          scale: resolution,
          rotation: (pdfPage.rotate + page.rotation) % 360,
        });
        const buffer = document.createElement("canvas");
        buffer.width = Math.ceil(viewport.width);
        buffer.height = Math.ceil(viewport.height);
        task = pdfPage.render({ canvas: buffer, viewport });
        await task.promise;
        if (!cancelled && ref.current) {
          ref.current.width = buffer.width;
          ref.current.height = buffer.height;
          ref.current.getContext("2d")!.drawImage(buffer, 0, 0);
        }
        buffer.width = buffer.height = 0;
      } catch (e) {
        if (!cancelled && (e as Error).name !== "RenderingCancelledException")
          onError("This page could not be rendered. Try another PDF.");
      }
    };
    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [
    page.sourceId,
    page.sourceIndex,
    page.rotation,
    scale,
    visible,
    size.width,
    size.height,
    onError,
  ]);
  return (
    <canvas
      ref={ref}
      className="pdf-canvas"
      style={{ width: size.width * scale, height: size.height * scale }}
      aria-label={thumbnail ? "Page thumbnail" : "PDF page"}
    />
  );
}
export function Marks({ page }: { page: EditorPage }) {
  return (
    <g transform={rotationTransform(page)}>
      {page.marks
        .filter((m) => m.sourceRect)
        .map((m) => (
          <rect key={"cover-" + m.id} {...m.sourceRect!} fill={m.background || "#ffffff"} />
        ))}
      {page.marks.map((m) => (
        <svg key={m.id} x={m.x} y={m.y} width={m.width} height={m.height} overflow="hidden">
          {m.kind === "text" &&
            (() => {
              let top = 0;
              return getLines(m).map((line, i) => {
                const baseline = top + lineSize(line);
                top += Math.max(line.leading, lineSize(line));
                return (
                  <text
                    key={i}
                    x={line.indent}
                    y={baseline}
                    xmlSpace="preserve"
                    style={{ whiteSpace: "pre" }}
                  >
                    {line.runs.map((run, n) => (
                      <tspan
                        key={n}
                        fill={run.style.color}
                        fontSize={run.style.fontSize}
                        fontFamily={run.style.fontFamily}
                        fontWeight={run.style.bold ? "bold" : "normal"}
                        fontStyle={run.style.italic ? "italic" : "normal"}
                      >
                        {expandTabs(run.text)}
                      </tspan>
                    ))}
                  </text>
                );
              });
            })()}
          {m.kind === "image" && (
            <image href={m.data} width={m.width} height={m.height} preserveAspectRatio="none" />
          )}
          {m.kind === "rectangle" && (
            <rect
              x={m.stroke / 2}
              y={m.stroke / 2}
              width={Math.max(0, m.width - m.stroke)}
              height={Math.max(0, m.height - m.stroke)}
              fill="none"
              stroke={m.color}
              strokeWidth={m.stroke}
            />
          )}
          {m.kind === "ellipse" && (
            <ellipse
              cx={m.width / 2}
              cy={m.height / 2}
              rx={Math.max(1, (m.width - m.stroke) / 2)}
              ry={Math.max(1, (m.height - m.stroke) / 2)}
              fill="none"
              stroke={m.color}
              strokeWidth={m.stroke}
            />
          )}
        </svg>
      ))}
    </g>
  );
}
