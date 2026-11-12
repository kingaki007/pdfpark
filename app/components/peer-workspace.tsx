import { useEffect, useRef, useState } from 'react';
import { FilePicker, Field } from './tool-workspace';
import { saveResult, type ToolResult } from '@/lib/toolkit-api';
type Stroke = {
  x: number;
  y: number;
  px: number;
  py: number;
  color: string;
  width: number;
};
export default function PeerWorkspace({ whiteboard }: { whiteboard: boolean }) {
  const [connected, setConnected] = useState(false);
  const [offer, setOffer] = useState(''),
    [incoming, setIncoming] = useState(''),
    [state, setState] = useState('Not connected'),
    [error, setError] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [received, setReceived] = useState<{
      name: string;
      result: ToolResult;
    } | null>(null),
    [color, setColor] = useState('#185be8'),
    [busy, setBusy] = useState(false);
  const connection = useRef<RTCPeerConnection | null>(null),
    channel = useRef<RTCDataChannel | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    last = useRef<{ x: number; y: number } | null>(null);
  const chunks = useRef<ArrayBuffer[]>([]),
    metadata = useRef<{ name: string; size: number; received: number } | null>(
      null,
    );
  useEffect(() => () => connection.current?.close(), []);
  function draw(s: Stroke) {
    if (
      ![s.x, s.y, s.px, s.py, s.width].every(Number.isFinite) ||
      s.width > 40 ||
      s.width < 1 ||
      !/^#[0-9a-f]{6}$/i.test(s.color)
    )
      return;
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.px, s.py);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  }
  function setup(dc: RTCDataChannel) {
    channel.current = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      setState('Connected to peer');
      setConnected(true);
    };
    dc.onclose = () => {
      setState('Disconnected');
      setConnected(false);
      metadata.current = null;
      chunks.current = [];
    };
    dc.onmessage = (e) => {
      try {
        if (typeof e.data === 'string') {
          const message = JSON.parse(e.data);
          if (message.kind === 'stroke' && whiteboard) draw(message.stroke);
          else if (message.kind === 'clear' && whiteboard)
            canvas.current?.getContext('2d')?.clearRect(0, 0, 1000, 700);
          else if (message.kind === 'file' && !whiteboard) {
            if (
              !Number.isSafeInteger(message.size) ||
              message.size < 0 ||
              message.size > 40 * 1024 * 1024
            )
              throw new Error('Incoming file exceeds 40 MB.');
            metadata.current = {
              name: String(message.name).replace(/[\\/]/g, '-').slice(0, 200),
              size: message.size,
              received: 0,
            };
            chunks.current = [];
          } else if (message.kind === 'end' && metadata.current) {
            const m = metadata.current;
            if (m.received !== m.size)
              throw new Error('Incomplete transfer. Please retry.');
            const bytes = new Uint8Array(m.size);
            let offset = 0;
            for (const c of chunks.current) {
              bytes.set(new Uint8Array(c), offset);
              offset += c.byteLength;
            }
            setReceived({
              name: m.name,
              result: {
                bytes,
                type: 'application/octet-stream',
                extension: m.name.split('.').pop() || 'bin',
              },
            });
            metadata.current = null;
            chunks.current = [];
            setState('File received. Download when ready.');
          }
        } else if (e.data instanceof ArrayBuffer && metadata.current) {
          metadata.current.received += e.data.byteLength;
          if (metadata.current.received > metadata.current.size)
            throw new Error('Transfer exceeded the declared size.');
          chunks.current.push(e.data);
          setState(
            'Receiving ' +
              Math.round(
                (metadata.current.received / metadata.current.size) * 100,
              ) +
              '%',
          );
        }
      } catch (e) {
        setError(String(e));
        metadata.current = null;
        chunks.current = [];
      }
    };
  }
  function create() {
    connection.current?.close();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    connection.current = pc;
    pc.ondatachannel = (e) => setup(e.channel);
    pc.onconnectionstatechange = () =>
      setState(
        pc.connectionState === 'connected'
          ? 'Connected to peer'
          : pc.connectionState,
      );
    return pc;
  }
  async function gather(pc: RTCPeerConnection) {
    if (pc.iceGatheringState !== 'complete')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pc.removeEventListener('icegatheringstatechange', changed);
          reject(
            new Error(
              'Connection discovery timed out. Retry on another network.',
            ),
          );
        }, 15000);
        const changed = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timer);
            pc.removeEventListener('icegatheringstatechange', changed);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', changed);
      });
    return btoa(JSON.stringify(pc.localDescription));
  }
  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tk-special-stack">
      <p className="tk-note">
        Pair two browsers by exchanging connection codes. Only send a code to
        the intended person: it allows them to connect and reveals network
        connection information. Google’s STUN service helps discover the direct
        connection; files and drawings are not sent to a file server. Some
        networks require a relay and cannot connect in this version.
      </p>
      <div className="tk-actions">
        <button
          className="tk-button"
          disabled={busy}
          onClick={() =>
            void guarded(async () => {
              const pc = create();
              setup(pc.createDataChannel(whiteboard ? 'whiteboard' : 'files'));
              await pc.setLocalDescription(await pc.createOffer());
              setOffer(await gather(pc));
              setState('Send this offer code to the other browser.');
            })
          }
        >
          1. Create connection
        </button>
        <button
          className="tk-button secondary"
          disabled={busy}
          onClick={() =>
            void guarded(async () => {
              const data = JSON.parse(atob(incoming.trim()));
              if (
                data.type !== 'offer' ||
                typeof data.sdp !== 'string' ||
                data.sdp.length > 100000
              )
                throw new Error('Paste a valid offer code.');
              const pc = create();
              await pc.setRemoteDescription(data);
              await pc.setLocalDescription(await pc.createAnswer());
              setOffer(await gather(pc));
              setState('Send this answer code back to the first browser.');
            })
          }
        >
          2. Answer received offer
        </button>
        <button
          className="tk-button secondary"
          disabled={busy}
          onClick={() =>
            void guarded(async () => {
              const data = JSON.parse(atob(incoming.trim()));
              if (
                data.type !== 'answer' ||
                typeof data.sdp !== 'string' ||
                data.sdp.length > 100000 ||
                !connection.current
              )
                throw new Error(
                  'Create a connection first, then paste its answer.',
                );
              await connection.current.setRemoteDescription(data);
            })
          }
        >
          3. Accept answer
        </button>
      </div>
      <label className="tk-field">
        Your connection code (copy and send)
        <textarea readOnly value={offer} rows={3} />
      </label>
      <label className="tk-field">
        Code from the other browser
        <textarea
          value={incoming}
          onChange={(e) => setIncoming(e.target.value.slice(0, 150000))}
          rows={3}
        />
      </label>
      <output className="tk-feedback">{state}</output>
      {error && (
        <p role="alert" className="tk-feedback error">
          {error}
        </p>
      )}
      {whiteboard ? (
        <>
          <Field
            label="Pen color"
            type="color"
            value={color}
            onChange={setColor}
          />
          <canvas
            ref={canvas}
            width={1000}
            height={700}
            className="tk-canvas"
            aria-label="Shared drawing canvas"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              last.current = {
                x: ((e.clientX - r.left) * 1000) / r.width,
                y: ((e.clientY - r.top) * 700) / r.height,
              };
            }}
            onPointerMove={(e) => {
              if (!last.current) return;
              const r = e.currentTarget.getBoundingClientRect(),
                x = ((e.clientX - r.left) * 1000) / r.width,
                y = ((e.clientY - r.top) * 700) / r.height;
              const stroke = {
                x,
                y,
                px: last.current.x,
                py: last.current.y,
                color,
                width: 3,
              };
              draw(stroke);
              if (channel.current?.readyState === 'open')
                channel.current.send(
                  JSON.stringify({ kind: 'stroke', stroke }),
                );
              last.current = { x, y };
            }}
            onPointerUp={() => (last.current = null)}
            onPointerCancel={() => (last.current = null)}
          />
          <div className="tk-actions">
            <button
              className="tk-button secondary"
              onClick={() => {
                canvas.current?.getContext('2d')?.clearRect(0, 0, 1000, 700);
                if (channel.current?.readyState === 'open')
                  channel.current.send(JSON.stringify({ kind: 'clear' }));
              }}
            >
              Clear canvas
            </button>
            <button
              className="tk-button"
              onClick={() =>
                canvas.current?.toBlob(async (b) => {
                  if (b)
                    saveResult(
                      {
                        bytes: new Uint8Array(await b.arrayBuffer()),
                        type: 'image/png',
                        extension: 'png',
                      },
                      'whiteboard',
                    );
                })
              }
            >
              Download drawing
            </button>
          </div>
        </>
      ) : (
        <>
          <FilePicker files={files} onChange={setFiles} accept="*" />
          <button
            className="tk-button"
            disabled={!files.length || busy || !connected}
            onClick={() =>
              void guarded(async () => {
                const dc = channel.current!,
                  file = files[0];
                dc.send(
                  JSON.stringify({
                    kind: 'file',
                    name: file.name,
                    size: file.size,
                  }),
                );
                const data = await file.arrayBuffer();
                for (let i = 0; i < data.byteLength; i += 16384) {
                  while (dc.bufferedAmount > 256 * 1024) {
                    if (dc.readyState !== 'open')
                      throw new Error('Connection closed during transfer.');
                    await new Promise((r) => setTimeout(r, 20));
                  }
                  dc.send(data.slice(i, i + 16384));
                  setState(
                    'Sending ' +
                      Math.round(
                        (Math.min(i + 16384, data.byteLength) /
                          data.byteLength) *
                          100,
                      ) +
                      '%',
                  );
                }
                dc.send(JSON.stringify({ kind: 'end' }));
                setState('File sent.');
              })
            }
          >
            Send file to connected peer
          </button>
          {received && (
            <button
              className="tk-button"
              onClick={() =>
                saveResult(
                  received.result,
                  received.name.replace(/\.[^.]+$/, ''),
                )
              }
            >
              Download received {received.name}
            </button>
          )}
        </>
      )}
    </div>
  );
}
