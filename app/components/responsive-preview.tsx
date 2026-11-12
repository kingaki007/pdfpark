import { useEffect, useRef, useState } from 'react';
const devices = [
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Laptop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Phone', width: 390, height: 844 },
];
// Development-only harness: the iframe has a real device-width layout viewport,
// even when the containing desktop app's browser panel is narrow.
export default function ResponsivePreview() {
  const [device, setDevice] = useState(devices[0]),
    [path, setPath] = useState('/'),
    [draft, setDraft] = useState('/'),
    [available, setAvailable] = useState(1440);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setAvailable(entries[0].contentRect.width),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, Math.max(0.15, (available - 24) / device.width));
  return (
    <div
      style={{
        background: '#e6e9ef',
        minHeight: '100dvh',
        color: '#182338',
        fontFamily: 'sans-serif',
      }}
    >
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'white',
          padding: 12,
          borderBottom: '1px solid #ccd2dc',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: 13, marginRight: 12 }}>
          PDF Park · responsive preview
        </strong>
        {devices.map((d) => (
          <button
            key={d.name}
            aria-pressed={device.name === d.name}
            onClick={() => setDevice(d)}
            style={{
              border: '1px solid #ccd2dc',
              borderRadius: 6,
              padding: '7px 10px',
              background: device.name === d.name ? '#185be8' : 'white',
              color: device.name === d.name ? 'white' : '#182338',
              fontSize: 12,
            }}
          >
            {d.name} · {d.width}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              draft.startsWith('/') &&
              !draft.startsWith('//') &&
              !draft.startsWith('/__preview')
            )
              setPath(draft);
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            aria-label="Preview route"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: 150,
              border: '1px solid #ccd2dc',
              borderRadius: 5,
              padding: 6,
              fontSize: 12,
            }}
          />
          <button type="submit">Go</button>
        </form>
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: '#185be8' }}
        >
          Open full page ↗
        </a>
      </header>
      <div ref={host} style={{ padding: 12, overflow: 'auto' }}>
        <div
          style={{
            width: device.width * scale,
            height: device.height * scale,
            margin: '0 auto',
            boxShadow: '0 8px 35px #0002',
            background: 'white',
          }}
        >
          <iframe
            title="Device preview"
            src={path}
            style={{
              width: device.width,
              height: device.height,
              border: 0,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'block',
            }}
          />
        </div>
        <p style={{ fontSize: 11, textAlign: 'center', padding: 12 }}>
          Actual viewport: {device.width} × {device.height} · Display scale:{' '}
          {Math.round(scale * 100)}%
        </p>
      </div>
    </div>
  );
}
