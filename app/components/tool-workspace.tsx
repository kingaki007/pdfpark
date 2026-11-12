import { lazy, Suspense, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react';
import type { ToolDefinition } from '@/lib/tool-catalog';
import { runTool, saveResult, type ToolResult } from '@/lib/toolkit-api';
import { api } from '@/lib/server-api';
import { zipSync } from 'fflate';
const SpecialTools = lazy(() => import('./special-tools'));
export function FilePicker({
  files,
  onChange,
  accept = '.pdf',
  multiple = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}) {
  const [error, setError] = useState('');
  const add = (incoming: File[]) => {
    setError('');
    const next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
    if (next.reduce((s, f) => s + f.size, 0) > 40 * 1024 * 1024) {
      setError('Choose at most 40 MB of files in total.');
      return;
    }
    onChange(next);
  };
  return (
    <>
      <label className="tk-dropzone">
        <Upload size={30} />
        <strong>
          {multiple
            ? 'Choose files to get started'
            : 'Choose a file to get started'}
        </strong>
        <span>Click to browse or drag and drop</span>
        <span>
          {accept === '*' ? 'Any file' : accept.replaceAll(',', ' · ')} · up to
          40 MB total
        </span>
        <input
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(Array.from(e.dataTransfer.files));
          }}
          aria-label="Choose documents"
          type="file"
          accept={accept === '*' ? undefined : accept}
          multiple={multiple}
          onChange={(e) => {
            add(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
      </label>
      {error && (
        <p className="tk-feedback error" role="alert">
          {error}
        </p>
      )}
      <div className="tk-file-list">
        {files.map((f, i) => (
          <div className="tk-file-row" key={i}>
            <FileText size={17} />
            <span>{f.name}</span>
            <small>{(f.size / 1024).toFixed(1)} KB</small>
            {multiple && (
              <>
                <button
                  aria-label={'Move ' + f.name + ' up'}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...files];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  aria-label={'Move ' + f.name + ' down'}
                  disabled={i === files.length - 1}
                  onClick={() => {
                    const next = [...files];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    onChange(next);
                  }}
                >
                  <ArrowDown size={14} />
                </button>
              </>
            )}
            <button
              aria-label={'Remove ' + f.name}
              onClick={() => onChange(files.filter((_, n) => n !== i))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="tk-field">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Choice({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: [string, string][];
}) {
  return (
    <label className="tk-field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function ToolWorkspace({ tool }: { tool: ToolDefinition }) {
  const [files, setFiles] = useState<File[]>([]),
    [options, setOptions] = useState<Record<string, string | boolean>>({
      range: '',
      text: '',
      preset: 'medium',
      angle: '90',
      dpi: '150',
      quality: '85',
      fontSize: '12',
      opacity: '0.25',
      start: '1',
      prefix: '',
      digits: '6',
      position: 'bottom',
      direction: 'horizontal',
      colorMode: 'dark',
      paper: 'original',
      margin: '0',
      perSheet: '4',
      maxMB: '5',
      splitMode: 'files',
      password: '',
      newPassword: '',
    });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<ToolResult | null>(null);
  const id = tool.id;
  function option(key: string, value: string | boolean) {
    setOptions((o) => ({ ...o, [key]: value }));
    setResult(null);
  }
  const field = (key: string, label: string, type = 'text', hint?: string) => (
    <Field
      key={key}
      label={label}
      value={String(options[key] ?? '')}
      onChange={(v) => option(key, v)}
      type={type}
      hint={hint}
    />
  );
  const select = (key: string, label: string, items: [string, string][]) => (
    <Choice
      key={key}
      label={label}
      value={String(options[key])}
      items={items}
      onChange={(v) => option(key, v)}
    />
  );
  async function execute() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      let output: ToolResult;
      if (tool.mode === 'convert') {
        const source = files[0].name.split('.').pop()?.toLowerCase() || '';
        const response = await api(
          '/convert?source=' +
            encodeURIComponent(source) +
            '&target=' +
            (tool.target || 'pdf'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: files[0],
          },
        );
        output = {
          bytes: new Uint8Array(await response.arrayBuffer()),
          extension: tool.target || 'pdf',
          type: response.headers.get('Content-Type') || 'application/pdf',
        };
      } else if (id === 'pdf-to-zip') {
        const entries: Record<string, Uint8Array> = {};
        for (let i = 0; i < files.length; i++)
          entries[i + 1 + '-' + files[i].name] = new Uint8Array(
            await files[i].arrayBuffer(),
          );
        output = {
          bytes: zipSync(entries),
          type: 'application/zip',
          extension: 'zip',
        };
      } else if (id === 'fingerprint-pdf') {
        const data = await files[0].arrayBuffer();
        const report: Record<string, string> = {};
        for (const algo of ['SHA-256', 'SHA-1'])
          report[algo] = Array.from(
            new Uint8Array(await crypto.subtle.digest(algo, data)),
            (b) => b.toString(16).padStart(2, '0'),
          ).join('');
        output = {
          bytes: new TextEncoder().encode(JSON.stringify(report, null, 2)),
          report,
          type: 'application/json',
          extension: 'json',
        };
      } else output = await runTool(id, files, options);
      setResult(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed.');
    } finally {
      setBusy(false);
    }
  }
  const noRange = [
    'merge-pdf',
    'alternate-mix-pdf',
    'pdf-size-analyzer',
    'privacy-scanner',
    'redaction-checker',
    'fingerprint-pdf',
    'pdf-to-zip',
    'images-to-pdf',
    'png-to-pdf',
    'csv-to-pdf',
    'ebook-to-pdf',
    'encrypt-pdf',
    'remove-password',
    'unlock-pdf',
    'repair-pdf',
    'compress-pdf',
    'flatten-pdf',
    'invert-pdf',
    'flip-pdf',
    'bates-numbering',
    'split-pdf-by-text',
    'split-pdf-by-bookmarks',
    'split-pdf-by-size',
    'gst-filing-prep',
  ];
  return (
    <>
      <header className="tk-tool-heading">
        <span className="tk-eyebrow">{tool.group}</span>
        <h1>{tool.title}</h1>
        <p>{tool.description}</p>
      </header>
      <div className="tk-workbench">
        {tool.mode === 'special' ? (
          <Suspense
            fallback={<div className="tk-loading">Preparing tool…</div>}
          >
            <SpecialTools tool={tool} />
          </Suspense>
        ) : (
          <>
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <FilePicker
                files={files}
                onChange={(f) => {
                  setFiles(f);
                  setResult(null);
                }}
                accept={tool.accept}
                multiple={tool.multiple}
              />
              {tool.mode === 'process' && (
                <div className="tk-options">
                  {!noRange.includes(id) &&
                    field(
                      'range',
                      id === 'split-pdf' ? 'Page groups' : 'Page range',
                      'text',
                      id === 'split-pdf'
                        ? 'Blank = one PDF per page. Groups: 1-3;4-6'
                        : 'Blank = all pages. Example: 1,3-5',
                    )}
                  {[
                    'redact-pdf',
                    'split-pdf-by-text',
                    'headers-footers',
                    'add-watermark',
                  ].includes(id) && (
                    <label className="tk-field tk-full">
                      {id === 'redact-pdf'
                        ? 'Text to permanently remove (one phrase per line)'
                        : 'Text'}
                      <textarea
                        value={String(options.text)}
                        onChange={(e) => option('text', e.target.value)}
                      />
                      {id === 'headers-footers' && (
                        <small>
                          Use {'{page}'} and {'{total}'} for page counters.
                        </small>
                      )}
                    </label>
                  )}
                  {id === 'compress-pdf' &&
                    select('preset', 'Compression', [
                      ['lossless', 'Lossless cleanup'],
                      ['light', 'Light — rasterized, 150 DPI'],
                      ['medium', 'Medium — rasterized, 110 DPI'],
                      ['heavy', 'Heavy — rasterized, 72 DPI'],
                    ])}
                  {['rotate-pdf', 'add-watermark'].includes(id) &&
                    select('angle', 'Rotation', [
                      ['0', '0°'],
                      ['90', '90°'],
                      ['180', '180°'],
                      ['270', '270°'],
                    ])}
                  {id === 'flip-pdf' &&
                    select('direction', 'Direction', [
                      ['horizontal', 'Horizontal'],
                      ['vertical', 'Vertical'],
                    ])}
                  {id === 'invert-pdf' &&
                    select('colorMode', 'Color mode', [
                      ['dark', 'Dark / inverted'],
                      ['sepia', 'Sepia'],
                      ['gray', 'Grayscale'],
                    ])}
                  {id === 'crop-resize-pdf' && (
                    <>
                      {field('margin', 'Crop margin (points)', 'number')}
                      {select('paper', 'Output paper', [
                        ['original', 'Original size'],
                        ['a4', 'A4'],
                        ['letter', 'Letter'],
                        ['a3', 'A3'],
                        ['legal', 'Legal'],
                      ])}
                    </>
                  )}
                  {id === 'multiple-pages-per-sheet' &&
                    select('perSheet', 'Pages per sheet', [
                      ['2', '2'],
                      ['4', '4'],
                      ['6', '6'],
                      ['9', '9'],
                      ['16', '16'],
                    ])}
                  {[
                    'pdf-to-jpg',
                    'pdf-to-png',
                    'pdf-to-tiff',
                    'flatten-pdf',
                    'invert-pdf',
                    'flip-pdf',
                  ].includes(id) &&
                    select('dpi', 'Resolution', [
                      ['72', '72 DPI'],
                      ['150', '150 DPI'],
                      ['300', '300 DPI'],
                      ['600', '600 DPI (4096 px maximum edge)'],
                    ])}
                  {['split-pdf-by-size', 'gst-filing-prep'].includes(id) &&
                    field('maxMB', 'Maximum size per part (MB)', 'number')}
                  {id === 'split-pdf-in-half' &&
                    select('splitMode', 'Split mode', [
                      ['files', 'Two PDF files'],
                      ['slice', 'Slice every page vertically'],
                    ])}
                  {['page-numbers', 'bates-numbering'].includes(id) && (
                    <>
                      {field('start', 'Starting number', 'number')}
                      {field('prefix', 'Prefix')}
                      {id === 'bates-numbering' &&
                        field('digits', 'Minimum digits', 'number')}
                    </>
                  )}
                  {[
                    'page-numbers',
                    'bates-numbering',
                    'headers-footers',
                  ].includes(id) &&
                    select('position', 'Position', [
                      ['bottom', 'Bottom center'],
                      ['top', 'Top center'],
                    ])}
                  {[
                    'add-watermark',
                    'page-numbers',
                    'bates-numbering',
                    'headers-footers',
                  ].includes(id) &&
                    field('fontSize', 'Font size (points)', 'number')}
                  {id === 'add-watermark' &&
                    field(
                      'opacity',
                      'Opacity (0.01–1)',
                      'number',
                      'Choose a PDF plus an optional PNG or JPG watermark.',
                    )}
                  {id === 'delete-pdf-pages' && (
                    <label className="tk-check">
                      <input
                        type="checkbox"
                        checked={Boolean(options.blank)}
                        onChange={(e) => option('blank', e.target.checked)}
                      />
                      Detect and remove visually blank pages instead
                    </label>
                  )}
                  {['encrypt-pdf', 'remove-password', 'unlock-pdf'].includes(
                    id,
                  ) &&
                    field(
                      'password',
                      'Existing password (if protected)',
                      'password',
                    )}
                  {id === 'encrypt-pdf' &&
                    field('newPassword', 'New opening password', 'password')}
                </div>
              )}
              <p className="tk-note">
                {tool.local
                  ? 'This tool processes your files on your device.'
                  : 'Files are sent to PDF Park only when you click Upload & process. Temporary processing files are removed after the request.'}
                {[
                  'compress-pdf',
                  'flatten-pdf',
                  'invert-pdf',
                  'flip-pdf',
                ].includes(id) &&
                  ' Rasterized output loses selectable text, interactive fields and links. Choose lossless cleanup when available to preserve text.'}
                {tool.mode === 'convert' &&
                  ' Office layout and fonts can differ; PDF to Word/Excel extracts text, and PowerPoint export uses page images.'}
              </p>
              <div className="tk-actions">
                <button
                  className="tk-button"
                  disabled={!files.length || busy}
                  onClick={() => void execute()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <SparkIcon />
                  )}
                  {busy
                    ? 'Processing…'
                    : tool.local
                      ? 'Process files'
                      : 'Upload & process'}
                </button>
              </div>
            </fieldset>
            {error && (
              <p className="tk-feedback error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <section aria-live="polite">
                <p className="tk-feedback">Your result is ready.</p>
                {result.report !== undefined && (
                  <pre className="tk-output">
                    {JSON.stringify(result.report, null, 2)}
                  </pre>
                )}
                <div className="tk-actions">
                  <button
                    className="tk-button"
                    onClick={() =>
                      saveResult(
                        result,
                        files[0]?.name.replace(/\.[^.]+$/, '') + '-' + id,
                      )
                    }
                  >
                    <Download size={17} />
                    Download {result.extension.toUpperCase()}
                  </button>
                  <button
                    className="tk-button secondary"
                    onClick={() => {
                      setFiles([]);
                      setResult(null);
                    }}
                  >
                    Start again
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        <section className="tk-help">
          <h2>How to use {tool.title.toLowerCase()}</h2>
          <p>1. Choose your document or enter the content requested above.</p>
          <p>
            2. Adjust the available settings and run the tool. Review any
            processing notice before sending files.
          </p>
          <p>
            3. Check the result and download a copy. Your original file stays
            unchanged.
          </p>
          <a href="/edit-pdf-text" className="tk-note">
            Need more control? Open the full PDF Park editor →
          </a>
        </section>
      </div>
    </>
  );
}
function SparkIcon() {
  return <FileText size={18} />;
}
