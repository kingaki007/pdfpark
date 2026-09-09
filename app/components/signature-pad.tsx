import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
export function SignaturePad({ onSave }: { onSave: (data: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  return <div className="signature-pad">
    <canvas ref={canvas} width={800} height={260} aria-label="Draw your signature" onPointerDown={e => {
      drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext('2d')!;
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#182338'; ctx.beginPath(); ctx.moveTo((e.clientX - r.left) * 800 / r.width, (e.clientY - r.top) * 260 / r.height);
    }} onPointerMove={e => { if (!drawing.current) return; const r = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext('2d')!; ctx.lineTo((e.clientX - r.left) * 800 / r.width, (e.clientY - r.top) * 260 / r.height); ctx.stroke(); setHasInk(true); }} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
    <div className="row end"><Button variant="outline" onClick={() => { canvas.current!.getContext('2d')!.clearRect(0, 0, 800, 260); setHasInk(false); }}>Clear</Button><Button disabled={!hasInk} onClick={() => onSave(canvas.current!.toDataURL('image/png'))}>Use signature</Button></div>
  </div>;
}
