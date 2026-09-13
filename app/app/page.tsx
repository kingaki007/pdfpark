"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  ImagePlus,
  LoaderCircle,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PdfCanvas, Marks } from "@/components/pdf-canvas";
import { SignaturePad } from "@/components/signature-pad";
import { LineEditor } from "@/components/line-editor";
import { extractTextBlocks } from "@/lib/pdf-text";
import { textHeight, getLines, canvasFont, expandTabs } from "@/lib/text-lines";
import { api } from "@/lib/server-api";
import { UnlockPdf } from "@/components/unlock-pdf";
import { DocumentConverter } from "@/components/document-converter";
import { OcrLibrary } from "@/components/ocr-library";
import {
  commit,
  undo,
  redo,
  emptyDocument,
  displaySize,
  fitMark,
  movePage,
  parsePageRange,
  rotationTransform,
  toPagePoint,
  type DocumentState,
  type EditorPage,
  type History,
  type Mark,
} from "@/lib/editor-model";
import {
  discardSourcesExcept,
  download,
  exportJpg,
  exportPdf,
  imageData,
  imagesToPdf,
  importPdf,
  loadImage,
  MAX_PAGES,
  sources,
} from "@/lib/pdf-engine";

type Tool = "select" | "text" | "rectangle" | "ellipse";
const tools = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "text", label: "Text", icon: Type },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
] as const;
export default function Home() {
  const [history, setHistory] = useState<History>({
    past: [],
    present: emptyDocument,
    future: [],
  });
  const doc = history.present;
  const [saved, setSaved] = useState(JSON.stringify(emptyDocument));
  const dirty = JSON.stringify(doc) !== saved;
  const [activeId, setActiveId] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const page = doc.pages.find((p) => p.id === activeId) ?? doc.pages[0];
  const pageIndex = page ? doc.pages.indexOf(page) : -1;
  const [tool, setTool] = useState<Tool>("select"),
    [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState("pdf"),
    [range, setRange] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [replacement, setReplacement] = useState<File[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [textBlocks, setTextBlocks] = useState<Record<string, Mark[]>>({});
  const [editLines, setEditLines] = useState(false);
  const [draft, setDraft] = useState<Mark | null>(null);
  const gesture = useRef<{
    mark: Mark;
    start: { x: number; y: number };
    mode: "move" | "resize" | "draw";
  } | null>(null);
  const operation = useRef(false);
  const openInput = useRef<HTMLInputElement>(null),
    mergeInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    convertInput = useRef<HTMLInputElement>(null);
  const selected =
    page?.marks.find((m) => m.id === selectedId) ??
    textBlocks[page?.id || ""]?.find((m) => m.id === selectedId);
  const shownPage =
    page && draft
      ? {
          ...page,
          marks: page.marks.some((m) => m.id === draft.id)
            ? page.marks.map((m) => (m.id === draft.id ? draft : m))
            : [...page.marks, draft],
        }
      : page;
  const size = page ? displaySize(page) : { width: 612, height: 792 };
  const pageScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = pageScroll.current;
    if (!container) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width === previousWidth) return;
      previousWidth = width;
      if (window.matchMedia("(max-width: 800px)").matches) {
        const style = getComputedStyle(container);
        const available = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        setZoom(Math.max(0.1, Math.min(1, available / size.width)));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [page?.id, size.width]);
  const change = useCallback(
    (next: DocumentState | ((doc: DocumentState) => DocumentState)) =>
      setHistory((h) => commit(h, typeof next === "function" ? next(h.present) : next)),
    [],
  );
  const showError = useCallback((message: string) => setError(message), []);
  const updatePage = (next: EditorPage) =>
    change((current) => ({
      ...current,
      pages: current.pages.map((p) => (p.id === next.id ? next : p)),
    }));
  const patchMark = (patch: Partial<Mark>) => {
    if (page && selected && !busy) {
      const next = fitMark({ ...selected, ...patch }, page);
      updatePage({
        ...page,
        marks: page.marks.some((m) => m.id === selected.id)
          ? page.marks.map((m) => (m.id === selected.id ? next : m))
          : [...page.marks, next],
      });
    }
  };
  const applyTextMark = (next: Mark) => {
    if (!page || busy) return;
    if (next.y + textHeight(getLines(next)) > page.height) {
      setError(
        "These lines exceed the page. Move the text box up or reduce line spacing before adding more.",
      );
      return;
    }
    const measure = document.createElement("canvas").getContext("2d")!;
    const neededWidth = Math.max(
      8,
      ...getLines(next).map(
        (line) =>
          line.indent +
          line.runs.reduce((sum, run) => {
            measure.font = canvasFont(run.style);
            return sum + measure.measureText(expandTabs(run.text)).width;
          }, 0) +
          2,
      ),
    );
    if (next.x + neededWidth > page.width) {
      setError(
        "This line extends past the page. Split it into another line or reduce its font size.",
      );
      return;
    }
    next = { ...next, width: Math.max(next.width, neededWidth) };
    const neighbors = [
      ...(textBlocks[page.id] || []).filter(
        (b) => !page.marks.some((m) => m.sourceBlockId === b.id),
      ),
      ...page.marks,
    ].filter((m) => m.id !== next.id);
    const overlap = (a: Mark, b: Mark) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    if (selected && neighbors.some((m) => overlap(next, m) && !overlap(selected, m))) {
      setError(
        "There is not enough room beside or below this paragraph. Move the text box or reduce its size or spacing.",
      );
      return;
    }
    setError("");
    updatePage({
      ...page,
      marks: page.marks.some((m) => m.id === next.id)
        ? page.marks.map((m) => (m.id === next.id ? next : m))
        : [...page.marks, next],
    });
  };
  async function startLineEditing() {
    if (!page) return;
    setTool("select");
    setEditLines(true);
    setSelectedId("");
    if (textBlocks[page.id]) return;
    await run("Finding text lines…", async () => {
      const blocks = await extractTextBlocks(page);
      setTextBlocks((current) => ({ ...current, [page.id]: blocks }));
      setNotice(
        blocks.length
          ? "Click a highlighted paragraph to edit its lines. Font matches may use substitutes. Edited pages export as images."
          : "No editable horizontal text found. Scans need OCR first; you can still add a text box.",
      );
    });
  }
  const removeMark = () => {
    if (page && selected && !busy) {
      const remaining = page.marks.filter((m) => m.id !== selectedId);
      updatePage({
        ...page,
        marks: selected.sourceRect
          ? [...remaining, { ...selected, lines: [], text: "" }]
          : remaining,
      });
      setSelectedId("");
    }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        busy ||
        signatureOpen ||
        exportOpen ||
        replacement ||
        leaveOpen ||
        (e.target as HTMLElement).closest("input,textarea,[contenteditable=true],[role=dialog]")
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
        setSelectedId("");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setHistory(redo);
        setSelectedId("");
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          removeMark();
        }
      }
      if (e.key === "Escape") {
        setSelectedId("");
        setTool("select");
        gesture.current = null;
        setDraft(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function run(label: string, action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed. Try another file.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }
  async function importFiles(files: File[], append = false) {
    if (!files.length) return;
    await run("Opening files…", async () => {
      const previousSources = new Set(sources.keys());
      try {
        const pages: EditorPage[] = [];
        for (const file of files) {
          if (file.size > 40 * 1024 * 1024)
            throw new Error("This file exceeds the 40 MB limit. Split or compress it first.");
          const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
          const bytes = isPdf
            ? new Uint8Array(await file.arrayBuffer())
            : await imagesToPdf([file]);
          pages.push(...(await importPdf(bytes)));
        }
        if (pages.length + (append ? doc.pages.length : 0) > MAX_PAGES)
          throw new Error("A document can contain at most " + MAX_PAGES + " pages.");
        const next = {
          name: append && doc.pages.length ? doc.name : files[0].name.replace(/\.[^.]+$/, ""),
          pages: append ? [...doc.pages, ...pages] : pages,
        };
        if (append) change(next);
        else {
          setHistory({ past: [], present: next, future: [] });
          setSaved(files.length === 1 && /\.pdf$/i.test(files[0].name) ? JSON.stringify(next) : "");
          await discardSourcesExcept(new Set(pages.map((p) => p.sourceId)));
        }
        setActiveId(pages[0].id);
        setSelectedId("");
        setEditLines(false);
        if (!append) setTextBlocks({});
        setChecked([]);
        setTool("select");
        setZoom(0.85);
        setNotice(
          pages.length +
            " page(s) " +
            (append ? "added" : "opened") +
            ". Files stay on this device.",
        );
      } catch (e) {
        await discardSourcesExcept(previousSources);
        throw e;
      }
    });
  }
  function requestOpen(files: File[]) {
    if (!files.length) return;
    if (dirty && doc.pages.length) setReplacement(files);
    else void importFiles(files);
  }
  function goHome() {
    if (operation.current) return;
    setLeaveOpen(false);
    void run("Closing document…", async () => {
      setHistory({ past: [], present: emptyDocument, future: [] });
      setSaved(JSON.stringify(emptyDocument));
      setActiveId("");
      setSelectedId("");
      setChecked([]);
      setTool("select");
      setZoom(1);
      setTextBlocks({});
      setEditLines(false);
      setRange("");
      setFormat("pdf");
      setDraft(null);
      gesture.current = null;
      setSignatureOpen(false);
      setExportOpen(false);
      setReplacement(null);
      await discardSourcesExcept(new Set());
    });
  }
  async function addImage(data: string) {
    if (!page) return;
    const img = await loadImage(data),
      width = Math.min(220, page.width * 0.6),
      height = (width * img.height) / img.width;
    const mark = fitMark(
      {
        id: crypto.randomUUID(),
        kind: "image",
        data,
        x: 40,
        y: 40,
        width,
        height,
        color: "#182338",
        fontSize: 20,
        stroke: 2,
      },
      page,
    );
    updatePage({ ...page, marks: [...page.marks, mark] });
    setSelectedId(mark.id);
    setTool("select");
  }
  function point(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return toPagePoint((e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom, page!);
  }
  function pointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!page || busy || e.button !== 0) return;
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool !== "select") {
      const mark = fitMark(
        {
          id: crypto.randomUUID(),
          kind: tool,
          x: p.x,
          y: p.y,
          width: tool === "text" ? 220 : 8,
          height: tool === "text" ? 60 : 8,
          text: tool === "text" ? "Your text" : undefined,
          color: "#182338",
          fontSize: 20,
          stroke: 2,
        },
        page,
      );
      if (tool === "text") {
        updatePage({ ...page, marks: [...page.marks, mark] });
        setSelectedId(mark.id);
        setTool("select");
      } else {
        gesture.current = { mark, start: p, mode: "draw" };
        setDraft(mark);
      }
      return;
    }
    const blockId = (e.target as Element)
      .closest("[data-source-block]")
      ?.getAttribute("data-source-block");
    if (blockId) {
      const block = textBlocks[page.id]?.find((b) => b.id === blockId);
      if (block) setSelectedId(block.id);
      return;
    }
    const target = (e.target as Element).closest("[data-mark]");
    const mark = page.marks.find((m) => m.id === target?.getAttribute("data-mark"));
    if (!mark) {
      setSelectedId("");
      return;
    }
    setSelectedId(mark.id);
    gesture.current = {
      mark,
      start: p,
      mode: target?.getAttribute("data-resize") ? "resize" : "move",
    };
    setDraft(mark);
  }
  function pointerMove(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || !page) return;
    const p = point(e),
      dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    const mark =
      g.mode === "move"
        ? { ...g.mark, x: g.mark.x + dx, y: g.mark.y + dy }
        : g.mode === "resize"
          ? {
              ...g.mark,
              width: g.mark.width + dx,
              height: g.mark.height + dy,
            }
          : {
              ...g.mark,
              x: Math.min(p.x, g.start.x),
              y: Math.min(p.y, g.start.y),
              width: Math.abs(dx),
              height: Math.abs(dy),
            };
    setDraft(fitMark(mark, page));
  }
  function pointerUp() {
    if (gesture.current && draft && page) {
      const next = page.marks.some((m) => m.id === draft.id)
        ? page.marks.map((m) => (m.id === draft.id ? draft : m))
        : [...page.marks, draft];
      updatePage({ ...page, marks: next });
      setSelectedId(draft.id);
      setTool("select");
    }
    gesture.current = null;
    setDraft(null);
  }
  async function save() {
    await run("Preparing download…", async () => {
      const indices = parsePageRange(range, doc.pages.length),
        pages = indices.map((i) => doc.pages[i]);
      const name = doc.name.replace(/[^\p{L}\p{N}_ -]/gu, "").slice(0, 100) || "document";
      if (format === "pdf") {
        download(
          await exportPdf(pages),
          name + (pages.length < doc.pages.length ? "-selected" : "") + ".pdf",
          "application/pdf",
        );
        if (pages.length === doc.pages.length) setSaved(JSON.stringify(doc));
      } else if (format === "jpg" || format === "png") {
        const output = await exportJpg(pages, name, format);
        download(output.bytes, output.name, output.type);
      } else {
        const bytes = await exportPdf(pages);
        if (bytes.byteLength > 40 * 1024 * 1024)
          throw new Error("The edited PDF exceeds the 40 MB conversion limit. Export fewer pages.");
        setBusy("Uploading & converting…");
        const response = await api("/convert?source=pdf&target=" + encodeURIComponent(format), {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
        });
        download(
          new Uint8Array(await response.arrayBuffer()),
          name + (pages.length < doc.pages.length ? "-selected" : "") + "." + format,
          response.headers.get("Content-Type") || "application/octet-stream",
        );
      }
      setExportOpen(false);
      setNotice("Download prepared. Your original file is unchanged.");
    });
  }
  const iconButton = (label: string, Icon: typeof Plus, action: () => void, disabled = false) => (
    <Button
      title={label}
      aria-label={label}
      variant="ghost"
      size="icon"
      onClick={action}
      disabled={disabled || !!busy}
    >
      <Icon size={18} />
    </Button>
  );
  return (
    <div className="studio">
      <header className="topbar">
        <button
          type="button"
          className="brand cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 disabled:cursor-wait"
          aria-label="PDF Park home"
          disabled={!!busy}
          onClick={() => {
            if (dirty) setLeaveOpen(true);
            else goHome();
          }}
        >
          <span className="brand-icon">
            <FileText size={23} />
          </span>
          <strong>PDF Park</strong>
        </button>
        <div className="document-name">
          <span>{doc.pages.length ? doc.name + ".pdf" : "No document open"}</span>
          {doc.pages.length > 0 && (
            <span className={"save-state " + (dirty ? "dirty" : "")}>
              {dirty ? "● Unsaved changes" : "✓ No unsaved changes"}
            </span>
          )}
        </div>
        <div className="row">
          <UnlockPdf disabled={!!busy} />
          <DocumentConverter disabled={!!busy} />
          <OcrLibrary pages={doc.pages} name={doc.name} disabled={!!busy} />
          <Button variant="outline" onClick={() => openInput.current?.click()} disabled={!!busy}>
            <Upload />
            Open file
          </Button>
          <Button
            disabled={!page || !!busy}
            onClick={() => {
              setRange(
                checked.length
                  ? doc.pages
                      .map((p, i) => (checked.includes(p.id) ? i + 1 : null))
                      .filter(Boolean)
                      .join(",")
                  : "",
              );
              setExportOpen(true);
            }}
          >
            <Download />
            Export
          </Button>
        </div>
      </header>
      <input
        hidden
        ref={openInput}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => {
          requestOpen(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={mergeInput}
        type="file"
        accept=".pdf"
        multiple
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []), true);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={convertInput}
        type="file"
        accept=".png,.jpg,.jpeg"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (page) void importFiles(files, true);
          else requestOpen(files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept=".png,.jpg,.jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run("Adding image…", async () => addImage(await imageData(file)));
          e.target.value = "";
        }}
      />
      <div className="toolbar">
        <div className="row tool-group">
          {tools.map((t) => (
            <Button
              key={t.id}
              variant={tool === t.id ? "secondary" : "ghost"}
              className={tool === t.id ? "tool-active" : ""}
              aria-pressed={tool === t.id}
              disabled={!page || !!busy}
              onClick={() => {
                setTool(t.id);
                setSelectedId("");
                setEditLines(false);
              }}
            >
              <t.icon />
              {t.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            disabled={!page || !!busy}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus />
            Image
          </Button>
          <Button
            variant={editLines ? "secondary" : "ghost"}
            disabled={!page || !!busy}
            aria-pressed={editLines}
            onClick={() => void startLineEditing()}
          >
            <Type />
            Edit lines
          </Button>
          <Button variant="ghost" disabled={!page || !!busy} onClick={() => setSignatureOpen(true)}>
            <PenLine />
            Signature
          </Button>
        </div>
        <div className="row">
          {iconButton(
            "Undo (Ctrl+Z)",
            Undo2,
            () => {
              setHistory(undo);
              setSelectedId("");
            },
            !history.past.length,
          )}
          {iconButton(
            "Redo (Ctrl+Shift+Z)",
            Redo2,
            () => {
              setHistory(redo);
              setSelectedId("");
            },
            !history.future.length,
          )}
        </div>
      </div>
      {(error || notice || busy) && (
        <div className={"message " + (error ? "error" : "")} role={error ? "alert" : "status"}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              {busy}
            </>
          ) : (
            error || notice
          )}
          {!busy && (
            <button
              aria-label="Dismiss message"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      <div className={"workspace" + (page ? " has-document" : "")}>
        <aside className="pages-panel">
          <div className="panel-heading">
            <strong>Pages</strong>
            <span>{doc.pages.length}</span>
          </div>
          <div className="page-list">
            {doc.pages.map((p, i) => {
              const ps = displaySize(p),
                scale = Math.min(124 / ps.width, 160 / ps.height);
              return (
                <div key={p.id} className={"thumbnail " + (p.id === page?.id ? "current" : "")}>
                  <button
                    className="thumbnail-preview"
                    aria-label={"Go to page " + (i + 1)}
                    aria-current={p.id === page?.id ? "page" : undefined}
                    disabled={!!busy}
                    onClick={() => {
                      setActiveId(p.id);
                      setSelectedId("");
                    }}
                  >
                    <div
                      style={{
                        width: ps.width * scale,
                        height: ps.height * scale,
                        position: "relative",
                      }}
                    >
                      <PdfCanvas page={p} scale={scale} thumbnail onError={showError} />
                      <svg className="thumb-marks" viewBox={"0 0 " + ps.width + " " + ps.height}>
                        <Marks page={p} />
                      </svg>
                    </div>
                  </button>
                  <div className="thumbnail-label">
                    <label>
                      <Checkbox
                        aria-label={"Select page " + (i + 1) + " for export"}
                        checked={checked.includes(p.id)}
                        disabled={!!busy}
                        onCheckedChange={(value) =>
                          setChecked((current) =>
                            value ? [...current, p.id] : current.filter((id) => id !== p.id),
                          )
                        }
                      />
                      <span>Page {i + 1}</span>
                    </label>
                    <div className="row">
                      {iconButton(
                        "Move page " + (i + 1) + " up",
                        ArrowUp,
                        () =>
                          change({
                            ...doc,
                            pages: movePage(doc.pages, p.id, -1),
                          }),
                        i === 0,
                      )}
                      {iconButton(
                        "Move page " + (i + 1) + " down",
                        ArrowDown,
                        () =>
                          change({
                            ...doc,
                            pages: movePage(doc.pages, p.id, 1),
                          }),
                        i === doc.pages.length - 1,
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!page && <p className="muted page-empty">Your pages will appear here.</p>}
          </div>
          <div className="page-actions">
            <Button variant="outline" disabled={!!busy} onClick={() => mergeInput.current?.click()}>
              <FilePlus2 />
              Merge PDFs
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => convertInput.current?.click()}>
              <FileImage />
              Image to PDF
            </Button>
          </div>
        </aside>
        <main className="canvas-area">
          {!page ? (
            <div className="empty-workspace">
              <div className="empty-icon">
                <FileText size={38} />
              </div>
              <h1>A fresh start for your PDF.</h1>
              <p>
                Open a document to add text, images, shapes,
                <br />
                and signatures. Editing stays on your device. OCR is optional.
              </p>
              <Button size="lg" disabled={!!busy} onClick={() => openInput.current?.click()}>
                <Plus />
                Open PDF or image
              </Button>
              <span className="muted">Open or drop PDF, PNG or JPG to edit · up to 40 MB each</span>
              <p className="muted supported-formats">
                Use <strong>Create PDF / Convert</strong> for Word (DOC, DOCX), Excel (XLS, XLSX),
                PowerPoint (PPT, PPTX), OpenDocument (ODT, ODS, ODP), RTF, Markdown (MD, MARKDOWN),
                TXT, and images (PNG, JPG, JPEG, WebP, BMP, GIF, TIF, TIFF). Convert to PDF, then
                open the download to edit.
              </p>
              <button
                className="text-link"
                disabled={!!busy}
                onClick={() => convertInput.current?.click()}
              >
                Convert images to a PDF
              </button>
            </div>
          ) : (
            <>
              <div className="canvas-controls">
                <div className="row">
                  {iconButton(
                    "Previous page",
                    ChevronLeft,
                    () => {
                      setActiveId(doc.pages[pageIndex - 1].id);
                      setSelectedId("");
                    },
                    pageIndex <= 0,
                  )}
                  <span>
                    Page {pageIndex + 1} / {doc.pages.length}
                  </span>
                  {iconButton(
                    "Next page",
                    ChevronRight,
                    () => {
                      setActiveId(doc.pages[pageIndex + 1].id);
                      setSelectedId("");
                    },
                    pageIndex >= doc.pages.length - 1,
                  )}
                </div>
                <div className="row">
                  {iconButton(
                    "Zoom out",
                    ZoomOut,
                    () => setZoom((z) => Math.max(0.25, z - 0.15)),
                    zoom <= 0.25,
                  )}
                  <span>{Math.round(zoom * 100)}%</span>
                  {iconButton(
                    "Zoom in",
                    ZoomIn,
                    () => setZoom((z) => Math.min(2.5, z + 0.15)),
                    zoom >= 2.5,
                  )}
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() =>
                      setZoom(
                        Math.max(
                          0.1,
                          Math.min(
                            1.4,
                            (document.querySelector(".canvas-area")!.clientWidth - 80) / size.width,
                          ),
                        ),
                      )
                    }
                  >
                    Fit
                  </Button>
                </div>
              </div>
              <div className="page-scroll" ref={pageScroll}>
                <div
                  className="paper"
                  style={{
                    width: size.width * zoom,
                    height: size.height * zoom,
                  }}
                >
                  <PdfCanvas page={page} scale={zoom} onError={showError} />
                  <svg
                    className={"editing-overlay tool-" + tool}
                    viewBox={"0 0 " + size.width + " " + size.height}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={() => {
                      gesture.current = null;
                      setDraft(null);
                    }}
                    aria-label="Page editing surface"
                  >
                    <Marks page={shownPage!} />
                    <g transform={rotationTransform(page)}>
                      {editLines &&
                        (textBlocks[page.id] || [])
                          .filter((b) => !page.marks.some((m) => m.sourceBlockId === b.id))
                          .map((b) => (
                            <rect
                              key={b.id}
                              data-source-block={b.id}
                              x={b.x}
                              y={b.y}
                              width={b.width}
                              height={b.height}
                              fill="rgba(24,91,232,0.06)"
                              stroke="#185be8"
                              strokeDasharray="3 3"
                              strokeWidth={1 / zoom}
                              style={{
                                cursor: "text",
                              }}
                            >
                              <title>Click to edit these lines</title>
                            </rect>
                          ))}
                      {shownPage!.marks.map((m) => (
                        <g key={m.id}>
                          <rect
                            data-mark={m.id}
                            x={m.x}
                            y={m.y}
                            width={m.width}
                            height={m.height}
                            fill="transparent"
                            stroke={selectedId === m.id ? "#185be8" : "none"}
                            strokeWidth={1.5 / zoom}
                            style={{
                              cursor: "move",
                            }}
                          />
                          {selectedId === m.id && (
                            <rect
                              data-mark={m.id}
                              data-resize="true"
                              x={m.x + m.width - 6 / zoom}
                              y={m.y + m.height - 6 / zoom}
                              width={12 / zoom}
                              height={12 / zoom}
                              fill="white"
                              stroke="#185be8"
                              strokeWidth={1.5 / zoom}
                              style={{
                                cursor: "nwse-resize",
                              }}
                            />
                          )}
                        </g>
                      ))}
                    </g>
                  </svg>
                </div>
                <p className="canvas-hint">
                  {editLines
                    ? "Click a highlighted paragraph, then select a line in the properties panel."
                    : tool === "text"
                      ? "Click the page to add a text box."
                      : tool === "rectangle" || tool === "ellipse"
                        ? "Drag on the page to draw a shape."
                        : "Select an object to move it. Drag its corner to resize."}
                </p>
              </div>
            </>
          )}
        </main>
        <aside className="properties-panel">
          <div className="panel-heading">
            <strong>{selected ? "Object properties" : "Document tools"}</strong>
          </div>
          {selected ? (
            <div className="properties">
              <span className="eyebrow">{selected.kind}</span>
              {selected.kind === "text" && (
                <LineEditor
                  key={selected.id}
                  mark={selected}
                  onChange={applyTextMark}
                  disabled={!!busy}
                />
              )}
              <div hidden={selected.kind === "text"}>
                {selected.kind !== "image" && (
                  <label>
                    Color
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(e) =>
                        patchMark({
                          color: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
              </div>
              <div className="property-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      aria-label={"Object " + key}
                      type="number"
                      step="1"
                      value={Math.round(selected[key])}
                      onChange={(e) =>
                        patchMark({
                          [key]: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              {(selected.kind === "rectangle" || selected.kind === "ellipse") && (
                <label>
                  Line width
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={selected.stroke}
                    onChange={(e) =>
                      patchMark({
                        stroke: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                      })
                    }
                  />
                </label>
              )}
              <Button variant="destructive" onClick={removeMark} disabled={!!busy}>
                <Trash2 />
                Delete object
              </Button>
            </div>
          ) : (
            <div className="properties">
              <p className="muted">Choose a tool above, then click or drag on the page.</p>
              <div className="property-section">
                <span className="eyebrow">CURRENT PAGE</span>
                <Button
                  variant="outline"
                  disabled={!page || !!busy}
                  onClick={() => {
                    updatePage({
                      ...page!,
                      rotation: (page!.rotation + 90) % 360,
                    });
                    setSelectedId("");
                  }}
                >
                  <RotateCw />
                  Rotate 90°
                </Button>
                <Button
                  variant="outline"
                  disabled={!page || doc.pages.length <= 1 || !!busy}
                  onClick={() => {
                    change({
                      ...doc,
                      pages: doc.pages.filter((p) => p.id !== page!.id),
                    });
                    setActiveId(doc.pages[Math.max(0, pageIndex - 1)].id);
                  }}
                >
                  <Trash2 />
                  Delete page
                </Button>
              </div>
              <div className="property-section">
                <span className="eyebrow">CONVERT & COMBINE</span>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => mergeInput.current?.click()}
                >
                  <FilePlus2 />
                  Merge PDFs
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => convertInput.current?.click()}
                >
                  <FileImage />
                  Image to PDF
                </Button>
                <Button
                  variant="ghost"
                  disabled={!page || !!busy}
                  onClick={() => {
                    setFormat("jpg");
                    setRange("");
                    setExportOpen(true);
                  }}
                >
                  <Download />
                  Export to JPG
                </Button>
              </div>
            </div>
          )}
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Private by default</strong>
              <p>Editing stays in this browser.</p>
            </div>
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <ShieldCheck size={14} />
          Local processing
        </span>
        <span>
          {checked.length
            ? checked.length + " pages selected for export"
            : "PDF Park · Browser editor"}
        </span>
        <a href="/tools.html">PDF tools &amp; supported formats</a>
        <a href="mailto:admin@pdfpark.in">Contact us: admin@pdfpark.in</a>
      </footer>
      <Dialog open={signatureOpen} onOpenChange={setSignatureOpen}>
        <DialogContent className="signature-dialog">
          <DialogHeader>
            <DialogTitle>Add your signature</DialogTitle>
            <DialogDescription>
              Draw below, or upload a PNG/JPG of your signature. This adds a signature image.
            </DialogDescription>
          </DialogHeader>
          <SignaturePad
            onSave={(data) => {
              void run("Adding signature…", () => addImage(data));
              setSignatureOpen(false);
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setSignatureOpen(false);
              imageInput.current?.click();
            }}
          >
            <ImagePlus />
            Upload signature image
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exportOpen}
        onOpenChange={(value) => {
          if (!busy) setExportOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export document</DialogTitle>
            <DialogDescription>Download all pages or choose a range.</DialogDescription>
          </DialogHeader>
          <div className="form-label">
            <span>Format</span>
            <Select
              value={format}
              disabled={!!busy}
              onValueChange={(value) => setFormat(value ?? "pdf")}
            >
              <SelectTrigger id="export-format" aria-label="Export format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF document</SelectItem>
                <SelectItem value="jpg">JPG images</SelectItem>
                <SelectItem value="png">PNG images</SelectItem>
                <SelectItem value="md">Markdown (.md)</SelectItem>
                <SelectItem value="docx">Word document (.docx)</SelectItem>
                <SelectItem value="xlsx">Excel workbook (.xlsx)</SelectItem>
                <SelectItem value="pptx">PowerPoint slides (.pptx)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="form-label">
            Pages
            <input
              placeholder="All pages (or 1, 3-5)"
              disabled={!!busy}
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
          <p className="muted">
            {format === "md"
              ? "Uploads selected, edited pages to extract text as Markdown. Layout, images and tables are not reconstructed. Scans and flattened edits need OCR first."
              : format === "docx"
                ? "Uploads the selected, edited pages for Word conversion. Extracts selectable text; layout and images are not retained. Scanned pages and flattened edits need OCR first."
                : format === "xlsx"
                  ? "Uploads the selected, edited pages for Excel conversion. One worksheet per page, with text in rows; tables and formulas are not reconstructed. Scanned pages and flattened edits need OCR first."
                  : format === "pptx"
                    ? "Uploads the selected, edited pages for PowerPoint conversion. One page image per slide; text is not editable."
                    : format === "png"
                      ? "Lossless PNG images, up to 4096 pixels per side. Multiple pages download as a ZIP. Files stay on this device."
                      : format === "jpg"
                        ? "Multiple pages download as a ZIP. JPGs are limited to 4096 pixels per side."
                        : "Added objects are flattened. Pages with edited original text become images and lose selectable text; use Searchable PDF for OCR."}
          </p>
          {error && (
            <p role="alert" className="export-error">
              {error}
            </p>
          )}
          <Button onClick={() => void save()} disabled={!!busy}>
            {busy ? <LoaderCircle className="spin" /> : <Download />}
            {busy ||
              (["docx", "xlsx", "pptx", "md"].includes(format) ? "Upload & export" : "Download")}
          </Button>
        </DialogContent>
      </Dialog>
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Leave this document?</AlertDialogTitle>
          <AlertDialogDescription>
            Any unsaved changes will be lost. Leave and return to home?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={goHome}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!replacement}
        onOpenChange={(value) => {
          if (!value) setReplacement(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Replace this document?</AlertDialogTitle>
          <AlertDialogDescription>
            Your current changes have not been exported. Replacing the document will discard them.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const files = replacement!;
                setReplacement(null);
                void importFiles(files);
              }}
            >
              Replace document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
