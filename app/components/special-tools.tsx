import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import type { ToolDefinition } from '@/lib/tool-catalog';
import {
  runTool,
  saveResult,
  localText,
  escapeHtml,
  type ToolResult,
} from '@/lib/toolkit-api';
import { Choice, Field, FilePicker } from './tool-workspace';
import { DocumentConverter } from './document-converter';
import { OcrLibrary } from './ocr-library';
import { importPdf, discardSourcesExcept } from '@/lib/pdf-engine';
import type { EditorPage } from '@/lib/editor-model';
import { PDFDocument } from 'pdf-lib';
const PeerWorkspace = lazy(() => import('./peer-workspace'));
const AiTools = lazy(() => import('./ai-tools'));
export default function SpecialTools({ tool }: { tool: ToolDefinition }) {
  if (['p2p-share', 'collab-whiteboard'].includes(tool.id))
    return (
      <Suspense fallback={<p>Preparing connection…</p>}>
        <PeerWorkspace whiteboard={tool.id === 'collab-whiteboard'} />
      </Suspense>
    );
  if (
    [
      'chat-with-pdf',
      'summarize-pdf',
      'audio-to-pdf',
      'handwriting-to-pdf',
    ].includes(tool.id)
  )
    return (
      <Suspense fallback={<p>Preparing AI workspace…</p>}>
        <AiTools tool={tool} />
      </Suspense>
    );
  if (tool.id === 'document-converter')
    return (
      <div className="tk-special-stack">
        <p className="tk-note">
          Convert Office documents, Markdown, text and images. The original
          converter and its password-protected PDF output remain available.
        </p>
        <DocumentConverter disabled={false} />
      </div>
    );
  if (['ocr-pdf', 'ocr-library'].includes(tool.id)) return <OcrWorkspace />;
  if (['gst-invoice', 'pos-billing'].includes(tool.id))
    return <Billing pos={tool.id === 'pos-billing'} />;
  if (tool.id === 'scan-to-pdf') return <Scanner />;
  if (tool.id === 'workflow') return <Workflow />;
  return <DocumentSpecial tool={tool} />;
}
export function Result({
  result,
  name = 'pdfpark-result',
}: {
  result: ToolResult | null;
  name?: string;
}) {
  return (
    result && (
      <div className="tk-actions">
        <button className="tk-button" onClick={() => saveResult(result, name)}>
          <Download size={17} />
          Download {result.extension.toUpperCase()}
        </button>
      </div>
    )
  );
}
export function ErrorMessage({ text }: { text: string }) {
  return (
    text && (
      <p role="alert" className="tk-feedback error">
        {text}
      </p>
    )
  );
}
function OcrWorkspace() {
  const [files, setFiles] = useState<File[]>([]),
    [pages, setPages] = useState<EditorPage[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      void discardSourcesExcept(new Set());
    },
    [],
  );
  async function load(f: File[]) {
    setFiles(f);
    setPages([]);
    setError('');
    if (!f[0]) return;
    setBusy(true);
    try {
      await discardSourcesExcept(new Set());
      setPages(await importPdf(new Uint8Array(await f[0].arrayBuffer())));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <FilePicker files={files} onChange={(f) => void load(f)} />
      <p className="tk-note">
        Select a PDF, then open your library to sign in and create a searchable
        PDF. Existing jobs are accessible without selecting a new file.
      </p>
      <OcrLibrary
        pages={pages}
        name={files[0]?.name.replace(/\.pdf$/i, '') || 'document'}
        disabled={busy}
        triggerLabel="Open OCR library"
      />
      <ErrorMessage text={error} />
    </>
  );
}
function DocumentSpecial({ tool }: { tool: ToolDefinition }) {
  const [files, setFiles] = useState<File[]>([]),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<ToolResult | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
  });
  const [fields, setFields] = useState<
      { name: string; value: string; type: string; choices: string[] }[]
    >([]),
    [flatten, setFlatten] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [urls, setUrls] = useState<string[]>([]),
    [speechRate, setSpeechRate] = useState('1'),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [voice, setVoice] = useState('');
  const [ink, setInk] = useState('#163b73'),
    [paper, setPaper] = useState('lined'),
    [threshold, setThreshold] = useState('210');
  const canvas = useRef<HTMLCanvasElement>(null),
    rich = useRef<HTMLDivElement>(null);
  const id = tool.id;
  useEffect(() => {
    if (id !== 'pdf-to-audio') return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => {
      speechSynthesis.cancel();
      speechSynthesis.removeEventListener('voiceschanged', update);
    };
  }, [id]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  function selectFiles(next: File[]) {
    setFiles(next);
    setUrls(next.map((f) => URL.createObjectURL(f)));
    setLoaded(false);
    setResult(null);
  }
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function inspect() {
    const r = await runTool('inspect-pdf', files);
    const data = r.report as {
      metadata: Record<string, string>;
      fields: typeof fields;
    };
    setMetadata(
      Object.fromEntries(
        Object.entries(data.metadata).filter(([k]) =>
          ['title', 'author', 'subject', 'keywords'].includes(k),
        ),
      ),
    );
    setFields(data.fields.map((f) => ({ ...f, value: String(f.value ?? '') })));
    setLoaded(true);
  }
  async function handwriting() {
    let content = text;
    if (id === 'pdf-to-handwriting')
      content = (await localText(files[0])).join('\n\n');
    if (!content.trim()) throw new Error('Enter some text first.');
    const c = canvas.current!;
    c.width = 1190;
    c.height = 1684;
    const ctx = c.getContext('2d')!;
    ctx.font = 'italic 27px cursive';
    const lines: string[] = [];
    for (const line of content.split('\n')) {
      let current = '';
      for (const word of line.split(/\s+/)) {
        if (ctx.measureText(current + ' ' + word).width > 990 && current) {
          lines.push(current);
          current = word;
        } else current += (current ? ' ' : '') + word;
      }
      lines.push(current);
    }
    const pdf = await PDFDocument.create();
    for (let start = 0; start < lines.length; start += 35) {
      ctx.fillStyle = '#fffef8';
      ctx.fillRect(0, 0, c.width, c.height);
      if (paper === 'lined') {
        ctx.strokeStyle = '#dce5ed';
        ctx.lineWidth = 1;
        for (let y = 144; y < 1600; y += 42) {
          ctx.beginPath();
          ctx.moveTo(60, y);
          ctx.lineTo(1130, y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = ink;
      ctx.font = 'italic 27px cursive';
      lines
        .slice(start, start + 35)
        .forEach((line, i) => ctx.fillText(line, 100, 137 + i * 42));
      const png = await pdf.embedPng(c.toDataURL('image/png'));
      pdf
        .addPage([595, 842])
        .drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
    }
    setResult({
      bytes: await pdf.save(),
      type: 'application/pdf',
      extension: 'pdf',
    });
  }
  async function thumbmark() {
    const bitmap = await createImageBitmap(files[0]);
    try {
      if (bitmap.width * bitmap.height > 24000000)
        throw new Error('Choose an image below 24 megapixels.');
      const c = canvas.current!;
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const light =
          (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
        if (light >= Number(threshold)) pixels.data[i + 3] = 0;
      }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob((b) =>
          b ? resolve(b) : reject(new Error('Image export failed.')),
        ),
      );
      setResult({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        type: 'image/png',
        extension: 'png',
      });
    } finally {
      bitmap.close();
    }
  }
  const needsFile = ![
    'text-to-handwriting',
    'create-pdf',
    'html-to-pdf',
    'latex-resume',
  ].includes(id);
  return (
    <div className="tk-special-stack">
      {needsFile && (
        <FilePicker
          files={files}
          onChange={selectFiles}
          accept={tool.accept}
          multiple={tool.multiple}
        />
      )}
      {['text-to-handwriting', 'html-to-pdf', 'latex-resume'].includes(id) && (
        <label className="tk-field">
          {id === 'html-to-pdf'
            ? 'HTML content (external resources are not loaded)'
            : id === 'latex-resume'
              ? 'Resume text — one section per paragraph'
              : 'Your text'}
          <textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      {id === 'create-pdf' && (
        <>
          <div className="tk-actions">
            {[
              ['bold', 'Bold'],
              ['italic', 'Italic'],
              ['insertUnorderedList', 'Bullet list'],
            ].map(([command, label]) => (
              <button
                key={command}
                className="tk-button secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  rich.current?.focus();
                  const selection = window.getSelection();
                  if (
                    !selection?.rangeCount ||
                    !rich.current?.contains(selection.anchorNode)
                  )
                    return;
                  const range = selection.getRangeAt(0);
                  const wrapper = document.createElement(
                    command === 'bold'
                      ? 'strong'
                      : command === 'italic'
                        ? 'em'
                        : 'ul',
                  );
                  const contents = range.extractContents();
                  if (command === 'insertUnorderedList') {
                    const item = document.createElement('li');
                    item.appendChild(contents);
                    wrapper.appendChild(item);
                  } else wrapper.appendChild(contents);
                  range.insertNode(wrapper);
                  selection.removeAllRanges();
                  range.selectNodeContents(wrapper);
                  selection.addRange(range);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {/* A rich-text editing surface needs textbox semantics, not a plain textarea. */}
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
          <div
            ref={rich}
            role="textbox"
            aria-label="Document content"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            className="tk-textarea"
            style={{ minHeight: 300 }}
          />
        </>
      )}
      {['text-to-handwriting', 'pdf-to-handwriting'].includes(id) && (
        <div className="tk-options">
          <Field label="Ink color" type="color" value={ink} onChange={setInk} />
          <Choice
            label="Paper"
            value={paper}
            onChange={setPaper}
            items={[
              ['lined', 'Lined'],
              ['plain', 'Plain'],
            ]}
          />
          <p className="tk-note tk-full">
            Uses your device’s cursive font to create handwritten-style notes.
            This does not reproduce a person’s handwriting.
          </p>
        </div>
      )}
      {id === 'thumbmark-generator' && (
        <Field
          label="Remove light pixels above (0–255)"
          value={threshold}
          type="number"
          onChange={setThreshold}
        />
      )}
      {['fill-pdf-form', 'edit-pdf-metadata'].includes(id) && (
        <>
          <button
            className="tk-button secondary"
            disabled={!files.length || busy}
            onClick={() => void action(inspect)}
          >
            Upload & read {id === 'fill-pdf-form' ? 'fields' : 'metadata'}
          </button>
          {loaded && (
            <div className="tk-options">
              {id === 'edit-pdf-metadata' ? (
                Object.entries(metadata).map(([key, value]) => (
                  <Field
                    key={key}
                    label={key}
                    value={value || ''}
                    onChange={(v) => setMetadata((m) => ({ ...m, [key]: v }))}
                  />
                ))
              ) : (
                <>
                  {fields.length ? (
                    fields.map((f, i) =>
                      f.choices.length ? (
                        <Choice
                          key={i}
                          label={f.name}
                          value={f.value}
                          onChange={(v) =>
                            setFields((fs) =>
                              fs.map((x, n) =>
                                n === i ? { ...x, value: v } : x,
                              ),
                            )
                          }
                          items={f.choices.map((c) => [c, c])}
                        />
                      ) : (
                        <Field
                          key={i}
                          label={
                            f.name +
                            (f.type === 'CheckBox' ? ' (Off or /Yes)' : '')
                          }
                          value={f.value}
                          onChange={(v) =>
                            setFields((fs) =>
                              fs.map((x, n) =>
                                n === i ? { ...x, value: v } : x,
                              ),
                            )
                          }
                        />
                      ),
                    )
                  ) : (
                    <p>
                      No interactive form fields found. Use the editor to add
                      text instead.
                    </p>
                  )}
                  <label className="tk-check tk-full">
                    <input
                      type="checkbox"
                      checked={flatten}
                      onChange={(e) => setFlatten(e.target.checked)}
                    />
                    Flatten visible values after filling
                  </label>
                </>
              )}
            </div>
          )}
        </>
      )}
      {id === 'compare-pdfs' && files.length === 2 && (
        <div className="tk-compare">
          {urls.map((url, i) => (
            <iframe
              key={url}
              title={i === 0 ? 'First document' : 'Second document'}
              src={url}
            />
          ))}
        </div>
      )}
      {id === 'pdf-to-audio' && (
        <>
          <Choice
            label="Voice"
            value={voice}
            onChange={setVoice}
            items={[
              ['', 'Default device voice'],
              ...voices.map((v) => [v.voiceURI, v.name] as [string, string]),
            ]}
          />
          <Field
            label="Speed (0.5–2)"
            type="number"
            value={speechRate}
            onChange={setSpeechRate}
          />
          <div className="tk-actions">
            <button
              className="tk-button secondary"
              onClick={() => speechSynthesis.pause()}
            >
              <Pause size={16} />
              Pause
            </button>
            <button
              className="tk-button secondary"
              onClick={() => speechSynthesis.resume()}
            >
              <Play size={16} />
              Resume
            </button>
            <button
              className="tk-button secondary"
              onClick={() => speechSynthesis.cancel()}
            >
              <Square size={16} />
              Stop
            </button>
          </div>
          <p className="tk-note">
            Playback uses your device’s speech engine. Some voices may use their
            provider’s network service. Audio-file download is not provided by
            the browser speech API.
          </p>
        </>
      )}
      <button
        className="tk-button"
        disabled={
          busy ||
          (needsFile && !files.length) ||
          (['fill-pdf-form', 'edit-pdf-metadata'].includes(id) && !loaded)
        }
        onClick={() =>
          void action(async () => {
            if (['text-to-handwriting', 'pdf-to-handwriting'].includes(id))
              await handwriting();
            else if (id === 'thumbmark-generator') await thumbmark();
            else if (['fill-pdf-form', 'edit-pdf-metadata'].includes(id))
              setResult(
                await runTool(
                  id,
                  files,
                  id === 'fill-pdf-form'
                    ? {
                        fields: Object.fromEntries(
                          fields.map((f) => [f.name, f.value]),
                        ),
                        flatten,
                      }
                    : metadata,
                ),
              );
            else if (id === 'compare-pdfs') {
              if (files.length !== 2)
                throw new Error('Choose exactly two PDF files.');
              const [left, right] = await Promise.all(
                files.map((f) => localText(f)),
              );
              const a = left.join('\n').split('\n'),
                b = right.join('\n').split('\n');
              const removed = a.filter((l) => l.trim() && !b.includes(l)),
                added = b.filter((l) => l.trim() && !a.includes(l));
              setText(
                'Removed or changed:\n' +
                  removed.join('\n') +
                  '\n\nAdded or changed:\n' +
                  added.join('\n'),
              );
            } else if (id === 'pdf-to-audio') {
              const content = (await localText(files[0])).join('\n');
              setText(content);
              speechSynthesis.cancel();
              for (const chunk of content.match(/[^.!?]+[.!?]?/g) || []) {
                const utterance = new SpeechSynthesisUtterance(chunk);
                utterance.rate = Math.min(
                  2,
                  Math.max(0.5, Number(speechRate) || 1),
                );
                utterance.voice =
                  voices.find((v) => v.voiceURI === voice) || null;
                speechSynthesis.speak(utterance);
              }
            } else {
              const html =
                id === 'create-pdf'
                  ? rich.current?.innerHTML || ''
                  : id === 'html-to-pdf'
                    ? text
                    : '<h1>Resume</h1>' +
                      text
                        .split('\n\n')
                        .map(
                          (p) =>
                            '<p>' +
                            escapeHtml(p).replaceAll('\n', '<br/>') +
                            '</p>',
                        )
                        .join('');
              setResult(await runTool(id, [], { html }));
            }
          })
        }
      >
        {busy ? <LoaderCircle className="spin" size={17} /> : null}
        {busy
          ? 'Working…'
          : id === 'compare-pdfs'
            ? 'Compare text'
            : id === 'pdf-to-audio'
              ? 'Read aloud'
              : tool.local
                ? 'Generate result'
                : 'Upload & generate'}
      </button>
      {id === 'latex-resume' && (
        <button
          className="tk-button secondary"
          onClick={() => {
            const escaped = text.replace(
              /[\\{}$&#%_^~]/g,
              (c) =>
                ({
                  '\\': '\\textbackslash{}',
                  '^': '\\textasciicircum{}',
                  '~': '\\textasciitilde{}',
                })[c] || '\\' + c,
            );
            saveResult(
              {
                bytes: new TextEncoder().encode(
                  '\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}\n' +
                    escaped +
                    '\n\\end{document}',
                ),
                extension: 'tex',
                type: 'text/plain',
              },
              'resume',
            );
          }}
        >
          Download LaTeX source
        </button>
      )}
      {[
        'thumbmark-generator',
        'pdf-to-handwriting',
        'text-to-handwriting',
      ].includes(id) && (
        <canvas
          ref={canvas}
          className="tk-canvas"
          style={{
            display: result ? 'block' : 'none',
            maxHeight: 500,
            objectFit: 'contain',
          }}
        />
      )}
      {['compare-pdfs', 'pdf-to-audio'].includes(id) && text && (
        <pre className="tk-output">{text}</pre>
      )}
      <ErrorMessage text={error} />
      <Result result={result} />
    </div>
  );
}
function Scanner() {
  const [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(''),
    [result, setResult] = useState<ToolResult | null>(null),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  async function start() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
        setActive(true);
      }
    } catch {
      setError('Camera access failed. You can choose photos below instead.');
    }
  }
  async function capture() {
    const v = video.current!;
    if (!v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const b = await new Promise<Blob | null>((r) =>
      c.toBlob(r, 'image/jpeg', 0.9),
    );
    if (b)
      setFiles((f) => [
        ...f,
        new File([b], 'scan-' + (f.length + 1) + '.jpg', {
          type: 'image/jpeg',
        }),
      ]);
  }
  return (
    <div className="tk-special-stack">
      <video ref={video} playsInline muted hidden={!active} />
      <div className="tk-actions">
        <button
          className="tk-button secondary"
          onClick={() => void start()}
          disabled={active}
        >
          <Camera size={17} />
          Start camera
        </button>
        <button
          className="tk-button"
          disabled={!active}
          onClick={() => void capture()}
        >
          Capture page
        </button>
        <button
          className="tk-button secondary"
          disabled={!active}
          onClick={() => {
            stream.current?.getTracks().forEach((t) => t.stop());
            setActive(false);
          }}
        >
          Stop camera
        </button>
      </div>
      <FilePicker files={files} onChange={setFiles} accept="image/*" multiple />
      <p className="tk-note">
        Photograph the page square-on in good lighting. Capture and PDF creation
        stay on your device; crop the resulting PDF with Crop & Resize.
      </p>
      <button
        className="tk-button"
        disabled={!files.length || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const pdf = await PDFDocument.create();
            for (const f of files) {
              const bitmap = await createImageBitmap(f);
              try {
                const c = document.createElement('canvas');
                const scale = Math.min(
                  1,
                  2400 / Math.max(bitmap.width, bitmap.height),
                );
                c.width = bitmap.width * scale;
                c.height = bitmap.height * scale;
                c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
                const image = await pdf.embedJpg(
                  c.toDataURL('image/jpeg', 0.9),
                );
                const p = pdf.addPage([595, 842]);
                const s = Math.min(547 / image.width, 794 / image.height);
                p.drawImage(image, {
                  x: (595 - image.width * s) / 2,
                  y: (842 - image.height * s) / 2,
                  width: image.width * s,
                  height: image.height * s,
                });
              } finally {
                bitmap.close();
              }
            }
            setResult({
              bytes: await pdf.save(),
              extension: 'pdf',
              type: 'application/pdf',
            });
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Creating…' : 'Create PDF'}
      </button>
      <ErrorMessage text={error} />
      <Result result={result} />
    </div>
  );
}
function Workflow() {
  const [files, setFiles] = useState<File[]>([]),
    [steps, setSteps] = useState([
      { id: 'compress-pdf', text: '', angle: '90', prefix: '' },
    ]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<ToolResult | null>(null);
  return (
    <>
      <FilePicker files={files} onChange={setFiles} />
      {steps.map((s, i) => (
        <div className="tk-options" key={i}>
          <Choice
            label={'Step ' + (i + 1)}
            value={s.id}
            items={[
              ['compress-pdf', 'Compress'],
              ['rotate-pdf', 'Rotate'],
              ['add-watermark', 'Watermark'],
              ['page-numbers', 'Page numbers'],
              ['headers-footers', 'Header / footer'],
            ]}
            onChange={(id) =>
              setSteps((a) => a.map((x, n) => (n === i ? { ...x, id } : x)))
            }
          />
          <Field
            label="Text / prefix"
            value={s.text}
            onChange={(text) =>
              setSteps((a) =>
                a.map((x, n) => (n === i ? { ...x, text, prefix: text } : x)),
              )
            }
          />
          <button
            className="tk-button secondary"
            disabled={steps.length === 1}
            onClick={() => setSteps((a) => a.filter((_, n) => n !== i))}
          >
            Remove step
          </button>
        </div>
      ))}
      <div className="tk-actions">
        <button
          className="tk-button secondary"
          disabled={steps.length >= 8}
          onClick={() =>
            setSteps((a) => [
              ...a,
              { id: 'page-numbers', text: '', angle: '90', prefix: '' },
            ])
          }
        >
          <Plus size={16} />
          Add step
        </button>
        <button
          className="tk-button"
          disabled={busy || !files.length}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              let f = files[0],
                out: ToolResult | null = null;
              for (const s of steps) {
                out = await runTool(s.id, [f], { ...s, preset: 'lossless' });
                f = new File([out.bytes.slice().buffer], 'step.pdf', {
                  type: 'application/pdf',
                });
              }
              setResult(out);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Running workflow…' : 'Upload & run workflow'}
        </button>
      </div>
      <p className="tk-note">
        Runs steps from top to bottom. Each intermediate PDF is sent to the next
        server operation; temporary files are deleted after each request.
      </p>
      <ErrorMessage text={error} />
      <Result result={result} />
    </>
  );
}
type BillItem = {
  name: string;
  qty: number;
  price: number;
  gst: number;
  hsn: string;
};
function Billing({ pos }: { pos: boolean }) {
  const [seller, setSeller] = useState(''),
    [gstin, setGstin] = useState(''),
    [buyer, setBuyer] = useState(''),
    [number, setNumber] = useState('INV-001'),
    [interstate, setInterstate] = useState(false);
  const [items, setItems] = useState<BillItem[]>([
      { name: '', qty: 1, price: 0, gst: 18, hsn: '' },
    ]),
    [catalog, setCatalog] = useState<BillItem[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('pdfpark-products') || '[]');
      } catch {
        return [];
      }
    });
  const [result, setResult] = useState<ToolResult | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const subtotal = items.reduce((n, x) => n + x.qty * x.price, 0),
    tax = items.reduce((n, x) => n + (x.qty * x.price * x.gst) / 100, 0);
  function update(i: number, k: keyof BillItem, v: string) {
    setItems((a) =>
      a.map((x, n) =>
        n === i
          ? {
              ...x,
              [k]: ['name', 'hsn'].includes(k)
                ? v
                : Math.max(0, Number(v) || 0),
            }
          : x,
      ),
    );
    setResult(null);
  }
  return (
    <div className="tk-special-stack">
      <div className="tk-options">
        <Field
          label="Seller name and address"
          value={seller}
          onChange={setSeller}
        />
        <Field
          label="Seller GSTIN (if registered)"
          value={gstin}
          onChange={setGstin}
        />
        <Field
          label="Customer name and address"
          value={buyer}
          onChange={setBuyer}
        />
        <Field
          label="Invoice / receipt number"
          value={number}
          onChange={setNumber}
        />
        <label className="tk-check">
          <input
            type="checkbox"
            checked={interstate}
            onChange={(e) => setInterstate(e.target.checked)}
          />
          Interstate supply (IGST)
        </label>
      </div>
      {pos && catalog.length > 0 && (
        <label className="tk-field">
          Saved products
          <select
            defaultValue=""
            onChange={(e) => {
              const p = catalog[Number(e.target.value)];
              if (p) setItems((a) => [...a, { ...p, qty: 1 }]);
              e.target.value = '';
            }}
          >
            <option value="">Add product to cart…</option>
            {catalog.map((p, i) => (
              <option key={i} value={i}>
                {p.name} — {p.price}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="tk-table-wrap">
        <table className="tk-table">
          <thead>
            <tr>
              {['Item', 'HSN', 'Qty', 'Price', 'GST %', ''].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={i}>
                {(['name', 'hsn', 'qty', 'price', 'gst'] as const).map((k) => (
                  <td key={k}>
                    <input
                      aria-label={k + ' ' + (i + 1)}
                      type={['name', 'hsn'].includes(k) ? 'text' : 'number'}
                      min="0"
                      value={x[k]}
                      onChange={(e) => update(i, k, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    aria-label={'Remove item ' + (i + 1)}
                    disabled={items.length === 1}
                    onClick={() => setItems((a) => a.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tk-actions">
        <button
          className="tk-button secondary"
          onClick={() =>
            setItems((a) => [
              ...a,
              { name: '', hsn: '', qty: 1, price: 0, gst: 18 },
            ])
          }
        >
          Add item
        </button>
        {pos && (
          <button
            className="tk-button secondary"
            onClick={() => {
              const products = items.filter((x) => x.name.trim());
              setCatalog(products);
              try {
                localStorage.setItem(
                  'pdfpark-products',
                  JSON.stringify(products),
                );
              } catch {
                setError('Browser storage is unavailable.');
              }
            }}
          >
            Save product catalog
          </button>
        )}
      </div>
      <div className="tk-output">
        Subtotal: INR {subtotal.toFixed(2)}
        <br />
        {interstate ? 'IGST' : 'CGST + SGST'}: INR {tax.toFixed(2)}
        <br />
        <strong>Total: INR {(subtotal + tax).toFixed(2)}</strong>
      </div>
      <p className="tk-note">
        Verify tax rates, GSTIN and invoice requirements for your business
        before issuing. Catalog data stays in this browser. Invoice contents are
        sent to PDF Park when generating the PDF. No payment is collected.
      </p>
      <button
        className="tk-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            if (!seller.trim() || items.some((x) => !x.name.trim()))
              throw new Error('Enter the seller and a name for every item.');
            const h = escapeHtml;
            const content =
              '<h1>' +
              h(pos ? 'Receipt' : 'Tax Invoice') +
              '</h1><p>' +
              h(number) +
              ' · ' +
              h(new Date().toLocaleDateString()) +
              '</p><h2>' +
              h(seller) +
              '</h2><p>GSTIN: ' +
              h(gstin) +
              '</p><p>Bill to: ' +
              h(buyer) +
              '</p><table><tr><th>Item / HSN</th><th>Qty</th><th>Price</th><th>GST</th><th>Amount</th></tr>' +
              items
                .map(
                  (x) =>
                    '<tr><td>' +
                    h(x.name) +
                    ' / ' +
                    h(x.hsn) +
                    '</td><td>' +
                    x.qty +
                    '</td><td>' +
                    x.price.toFixed(2) +
                    '</td><td>' +
                    x.gst +
                    '%</td><td>' +
                    (x.price * x.qty).toFixed(2) +
                    '</td></tr>',
                )
                .join('') +
              '</table><p>Subtotal: INR ' +
              subtotal.toFixed(2) +
              '</p><p>' +
              (interstate
                ? 'IGST: INR ' + tax.toFixed(2)
                : 'CGST: INR ' +
                  (tax / 2).toFixed(2) +
                  '; SGST: INR ' +
                  (tax / 2).toFixed(2)) +
              '</p><h2>Total: INR ' +
              (subtotal + tax).toFixed(2) +
              '</h2>';
            setResult(
              await runTool(pos ? 'pos-billing' : 'gst-invoice', [], {
                html: content,
              }),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Generating…' : 'Generate PDF'}
      </button>
      <ErrorMessage text={error} />
      <Result result={result} name={number.replace(/[^a-z0-9-]/gi, '-')} />
    </div>
  );
}
