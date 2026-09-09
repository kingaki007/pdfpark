import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/server-api';
import { download } from '@/lib/pdf-engine';

const formats = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

export function DocumentConverter({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState('pdf');
  const [protection, setProtection] = useState('unlocked');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const source = file?.name.split('.').pop()?.toLowerCase() || '';
  const isPdf = source === 'pdf';
  const format = isPdf ? target : 'pdf';
  const supported = formats.includes(source);
  function clearPasswords() { setPassword(''); setConfirmation(''); }
  async function convert() {
    if (!file || busy) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      if (!supported) throw new Error('Unsupported file. Choose one of the formats listed below.');
      if (!file.size) throw new Error('Choose a non-empty file.');
      if (file.size > 40 * 1024 * 1024) throw new Error('Choose a file smaller than 40 MB.');
      let body: Blob = file;
      const locked = format === 'pdf' && protection === 'locked';
      if (locked) {
        const bytes = new TextEncoder().encode(password);
        if (!password.trim() || bytes.length > 40) throw new Error('Enter a password of 1–40 UTF-8 bytes (up to 40 English characters).');
        if (password !== confirmation) throw new Error('Passwords do not match.');
        const prefix = new Uint8Array(4);
        new DataView(prefix.buffer).setUint32(0, bytes.length);
        body = new Blob([prefix, bytes, file]);
      }
      const result = await api('/convert?source=' + encodeURIComponent(source) + '&target=' + format + '&protection=' + (locked ? 'locked' : 'unlocked'), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
      });
      download(new Uint8Array(await result.arrayBuffer()), file.name.replace(/\.[^.]+$/, '') + (format === 'pdf' ? locked ? '-locked' : '-unlocked' : '') + '.' + format,
        result.headers.get('Content-Type') || 'application/octet-stream');
      clearPasswords();
      setNotice(locked ? 'Locked PDF downloaded. Keep your password to open it.' : 'Converted document downloaded.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Conversion failed.'); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Create PDF / Convert</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (!value) clearPasswords(); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create PDF / Convert</DialogTitle><DialogDescription>Create a locked or unlocked PDF from a document, Markdown, text file or image. You can also convert PDFs to Office formats.</DialogDescription></DialogHeader>
        <label className="form-label">Source file<input type="file" disabled={busy} accept={formats.map(value => '.' + value).join(',')} onChange={e => { setFile(e.target.files?.[0] || null); setError(''); setNotice(''); }}/></label>
        {isPdf ? <label className="form-label">Convert to<select value={target} disabled={busy} onChange={e => { setTarget(e.target.value); clearPasswords(); setNotice(''); }}>
          <option value="pdf">PDF document</option>
          <option value="docx">Word (.docx) — editable text</option>
          <option value="xlsx">Excel (.xlsx) — text rows</option>
          <option value="pptx">PowerPoint (.pptx) — page images</option>
        </select></label> : file && <p>Output: PDF document</p>}
        {format === 'pdf' && <>
          <label className="form-label">PDF protection<select value={protection} disabled={busy} onChange={e => { setProtection(e.target.value); clearPasswords(); setNotice(''); }}>
            <option value="unlocked">Unlocked — opens without a password</option>
            <option value="locked">Locked — password required to open</option>
          </select></label>
          {protection === 'locked' && <>
            <label className="form-label">Password<input type="password" autoComplete="new-password" disabled={busy} value={password} onChange={e => setPassword(e.target.value)}/></label>
            <label className="form-label">Confirm password<input type="password" autoComplete="new-password" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label>
            <p className="muted">Use up to 40 English characters (40 UTF-8 bytes). Keep your password; it cannot be recovered.</p>
          </>}
        </>}
        <p className="muted">{isPdf ? target === 'pdf' ? 'For a password-protected source, use Unlock PDF with its current password first.' : target === 'docx' ? 'Extracts selectable text with page breaks. Original layout and images are not retained. Scans need OCR first.' : target === 'xlsx' ? 'One worksheet per page, one text line per row. Tables and formulas are not reconstructed. Scans need OCR first.' : 'One page image per slide. Appearance is preserved; slide text is not editable.' : 'Supports Word, Excel, PowerPoint, OpenDocument, RTF, Markdown (.md/.markdown), TXT (UTF-8/UTF-16), PNG, JPG, WebP, BMP, GIF and TIFF. Images fit A4 pages; each animation frame or TIFF page becomes a page. Office fonts and pagination may differ.'}</p>
        {(source === 'md' || source === 'markdown') && <p className="muted">Markdown supports headings, lists, tables, links and code blocks. Raw HTML is displayed as text; images are replaced by their alt text. Use UTF-8 or UTF-16.</p>}
        
        {file && !supported && <p role="alert">Unsupported file format. Choose a supported document, Markdown, text file or image.</p>}
        {error && <p role="alert">{error}</p>}{notice && <output>{notice}</output>}
        <Button disabled={!file || !supported || busy} onClick={() => void convert()}>{busy ? 'Converting…' : format === 'pdf' ? 'Upload & create PDF' : 'Upload & convert'}</Button>
      </DialogContent>
    </Dialog>
  </>;
}



