import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Mark } from '@/lib/editor-model';
import { fontFamilies, getLines, insertLine, lineText, replaceLineText, withLines, type TextStyle } from '@/lib/text-lines';
export function LineEditor({ mark, onChange, disabled }: { mark: Mark; onChange: (mark: Mark) => void; disabled: boolean }) {
  const lines = getLines(mark);
  const [active, setActive] = useState(0);
  const index = Math.min(active, Math.max(0, lines.length - 1));
  const line = lines[index];
  const style = line?.runs[0]?.style;
  function patchStyle(patch: Partial<TextStyle>) {
    onChange(withLines(mark, lines.map((l, i) => i === index ? { ...l, runs: l.runs.map(run => ({ ...run, style: { ...run.style, ...patch } })) } : l)));
  }
  return <fieldset disabled={disabled} className="line-editor">
    <legend>Text lines</legend>
    {lines.map((l, i) => <label key={i}>Line {i + 1}<input aria-label={'Line ' + (i + 1)} value={lineText(l)} onFocus={() => setActive(i)} style={{ whiteSpace: 'pre', fontFamily: l.runs[0].style.fontFamily }} onChange={e => onChange(withLines(mark, lines.map((v, n) => n === i ? replaceLineText(v, e.target.value) : v)))}/></label>)}
    {line && style ? <>
      <span className="muted">Formatting line {index + 1}. New lines inherit its style and indentation.</span>
      <div className="row"><Button variant="outline" onClick={() => { onChange(withLines(mark, insertLine(lines, index, false))); setActive(index); }}>Insert above</Button><Button variant="outline" onClick={() => { onChange(withLines(mark, insertLine(lines, index))); setActive(index + 1); }}>Insert below</Button></div>
      <Button variant="outline" onClick={() => { onChange(withLines(mark, lines.filter((_, i) => i !== index))); setActive(Math.max(0, index - 1)); }}>Remove line {index + 1}</Button>
      <label>Font<select aria-label="Line font" value={style.fontFamily} onChange={e => patchStyle({ fontFamily: e.target.value })}>{fontFamilies.map(font => <option key={font}>{font}</option>)}</select></label>
      <div className="property-grid"><label>Font size<input aria-label="Line font size" type="number" min={6} max={144} value={style.fontSize} onChange={e => patchStyle({ fontSize: Math.max(6, Math.min(144, Number(e.target.value) || 6)) })}/></label><label>Indent (pt)<input aria-label="Line indentation" type="number" min={0} max={mark.width - 8} value={Math.round(line.indent)} onChange={e => onChange(withLines(mark, lines.map((l, i) => i === index ? { ...l, indent: Math.max(0, Math.min(mark.width - 8, Number(e.target.value) || 0)) } : l)))}/></label></div>
      <label>Line spacing (pt)<input aria-label="Line spacing" type="number" min={style.fontSize} max={300} value={line.leading} onChange={e => onChange(withLines(mark, lines.map((l, i) => i === index ? { ...l, leading: Math.max(style.fontSize, Math.min(300, Number(e.target.value) || 0)) } : l)))}/></label>
      <div className="row"><Button variant={style.bold ? 'secondary' : 'outline'} aria-pressed={style.bold} onClick={() => patchStyle({ bold: !style.bold })}>Bold</Button><Button variant={style.italic ? 'secondary' : 'outline'} aria-pressed={style.italic} onClick={() => patchStyle({ italic: !style.italic })}>Italic</Button></div>
      <label>Line color<input aria-label="Line color" type="color" value={style.color} onChange={e => patchStyle({ color: e.target.value })}/></label>
    </> : <Button variant="outline" onClick={() => onChange(withLines(mark, getLines({ ...mark, lines: undefined, text: '' })))}>Add line</Button>}
    {mark.sourceRect && <label>Page background<input aria-label="Text background" type="color" value={mark.background || '#ffffff'} onChange={e => onChange({ ...mark, background: e.target.value })}/></label>}
    <p className="muted">Lines reflow within this paragraph. Nearby paragraphs and images stay in place.</p>
  </fieldset>;
}
