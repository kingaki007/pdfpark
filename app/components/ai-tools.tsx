import { useEffect, useRef, useState } from 'react';
import type { ToolDefinition } from '@/lib/tool-catalog';
import { localText, runTool, saveResult, escapeHtml } from '@/lib/toolkit-api';
import { FilePicker, Field } from './tool-workspace';
export default function AiTools({ tool }: { tool: ToolDefinition }) {
  const [files, setFiles] = useState<File[]>([]),
    [question, setQuestion] = useState(''),
    [output, setOutput] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const id = tool.id;
  useEffect(() => () => worker.current?.terminate(), []);
  async function run() {
    setBusy(true);
    setError('');
    setStatus('Reading file…');
    setOutput('');
    try {
      const task =
        id === 'audio-to-pdf'
          ? 'audio'
          : id === 'handwriting-to-pdf'
            ? 'handwriting'
            : id === 'chat-with-pdf'
              ? 'chat'
              : 'summary';
      let text = '',
        audio: Float32Array | undefined,
        image: string | undefined;
      if (task === 'audio') {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(
            await files[0].arrayBuffer(),
          );
          if (decoded.duration > 600)
            throw new Error('Choose audio shorter than ten minutes.');
          const offline = new OfflineAudioContext(
            1,
            Math.ceil(decoded.duration * 16000),
            16000,
          );
          const source = offline.createBufferSource();
          source.buffer = decoded;
          source.connect(offline.destination);
          source.start();
          audio = (await offline.startRendering()).getChannelData(0);
        } finally {
          await context.close();
        }
      } else if (task === 'handwriting') {
        image = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () =>
            typeof r.result === 'string'
              ? resolve(r.result)
              : reject(new Error('Image could not be read.'));
          r.onerror = () => reject(new Error('Image could not be read.'));
          r.readAsDataURL(files[0]);
        });
      } else {
        text = (await localText(files[0])).join('\n\n');
        if (!text.trim())
          throw new Error('This PDF has no selectable text. Run OCR first.');
        if (task === 'chat' && !question.trim())
          throw new Error('Enter a question about the document.');
      }
      worker.current ??= new Worker(
        new URL('../lib/ai.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current.onmessage = (e) => {
        if (e.data.status) setStatus(e.data.status);
        if (e.data.result !== undefined) {
          setOutput(e.data.result);
          setBusy(false);
          setStatus('Complete. Review AI output for errors.');
        }
        if (e.data.error) {
          setError(e.data.error);
          setBusy(false);
        }
      };
      worker.current.onerror = () => {
        setError(
          'The AI worker could not start. Check browser support and network access for the model download.',
        );
        setBusy(false);
      };
      worker.current.postMessage({ task, text, question, audio, image });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <div className="tk-special-stack">
      <FilePicker
        files={files}
        onChange={(f) => {
          setFiles(f);
          setOutput('');
        }}
        accept={tool.accept}
      />
      {id === 'chat-with-pdf' && (
        <Field label="Your question" value={question} onChange={setQuestion} />
      )}
      <p className="tk-note">
        Clicking Run downloads an English AI model from Hugging Face, then
        processes your content on this device. Models can be hundreds of
        megabytes and may be slow on phones. No document content is sent to the
        model host.{' '}
        {id === 'handwriting-to-pdf' &&
          'Use a tightly cropped image of one handwritten line; this model does not preserve whole-page layout.'}
      </p>
      <div className="tk-actions">
        <button
          className="tk-button"
          disabled={!files.length || busy}
          onClick={() => void run()}
        >
          {busy ? 'Working…' : 'Run on-device AI'}
        </button>
        {busy && (
          <button
            className="tk-button secondary"
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              setBusy(false);
              setStatus('Stopped.');
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {status && <output className="tk-note">{status}</output>}
      {error && (
        <p role="alert" className="tk-feedback error">
          {error}
        </p>
      )}
      {output && (
        <>
          <label className="tk-field">
            Review and edit result
            <textarea
              rows={12}
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
          </label>
          <div className="tk-actions">
            <button
              className="tk-button secondary"
              onClick={() =>
                saveResult(
                  {
                    bytes: new TextEncoder().encode(output),
                    type: 'text/plain',
                    extension: 'txt',
                  },
                  'ai-result',
                )
              }
            >
              Download text
            </button>
            <button
              className="tk-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await runTool('create-pdf', [], {
                    html: '<pre>' + escapeHtml(output) + '</pre>',
                  });
                  saveResult(result, 'ai-result');
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Upload reviewed text & create PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
