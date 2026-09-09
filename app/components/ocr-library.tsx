import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type OcrJob } from '@/lib/server-api';
import { parsePageRange, type EditorPage } from '@/lib/editor-model';
import { download, exportPdf } from '@/lib/pdf-engine';

export function OcrLibrary({ pages, name, disabled }: { pages: EditorPage[]; name: string; disabled: boolean }) {
  const [open, setOpen] = useState(false), [email, setEmail] = useState('');
  const [account, setAccount] = useState<string | null>(null), [password, setPassword] = useState('');
  const [register, setRegister] = useState(false), [jobs, setJobs] = useState<OcrJob[]>([]);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [range, setRange] = useState('');
  const locked = useRef(false);

  async function refresh() { setJobs(await (await api('/jobs')).json() as OcrJob[]); }
  useEffect(() => {
    if (!open) return;
    let disposed = false;

    void fetch('/api/auth/me', { credentials: 'same-origin' }).then(async response => {
      if (response.status === 401) { if (!disposed) { setAccount(null); setJobs([]); } return; }
      if (!response.ok) throw new Error('The OCR server is unavailable. Local editing still works.');
      const current = await response.json() as { email: string };
      const library = await (await api('/jobs')).json() as OcrJob[];
      if (!disposed) { setAccount(current.email); setJobs(library); }
    }).catch(() => { if (!disposed) setError('The OCR server is unavailable. Local editing still works.'); })
      .finally(() => { if (!disposed) setChecking(false); });
    return () => { disposed = true; };
  }, [open]);
  useEffect(() => {
    if (!open || !account) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await (await api('/jobs')).json() as OcrJob[];
        if (!disposed) setJobs(result);
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Could not refresh jobs.'); }
      finally { if (!disposed) timer = setTimeout(poll, 3000); }
    };
    timer = setTimeout(poll, 3000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [open, account]);

  async function perform(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The operation failed.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <>
    <Button variant="outline" disabled={disabled} onClick={() => { setChecking(true); setError(''); setOpen(true); }}>Searchable PDF</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="ocr-dialog"><DialogHeader><DialogTitle>Searchable PDF &amp; library</DialogTitle>
        <DialogDescription>Local editing needs no account. Upload an edited copy here to recognize English text and save a searchable PDF on the server.</DialogDescription>
      </DialogHeader>
        {checking ? <output>Checking account…</output> : !account ? <form className="ocr-form" onSubmit={event => {
          event.preventDefault(); void perform(async () => {
            const result = await (await api('/auth/' + (register ? 'register' : 'login'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
            })).json() as { email: string };
            setAccount(result.email); setPassword(''); await refresh();
          });
        }}>
          <label className="form-label">Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="form-label">Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <p className="muted">Use 10–128 characters for your password.</p>
          <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setRegister(!register)}>{register ? 'Already have an account? Sign in' : 'Create an account'}</Button>
        </form> : <>
          <div className="row"><span className="ocr-account">{account}</span><Button variant="ghost" disabled={busy} onClick={() => void perform(async () => {
            await api('/auth/logout', { method: 'POST' }); setAccount(null); setJobs([]);
          })}>Sign out</Button></div>
          <label className="form-label">Pages to recognize<input placeholder="All pages (or 1, 3-5)" value={range} disabled={busy} onChange={e => setRange(e.target.value)} /></label>
          <p className="muted">Includes your current edits. OCR rasterizes pages and may misread text. Files remain in your account until deleted. Up to 40 MB, 200 pages, and 10 saved jobs.</p>
          <Button disabled={busy || !pages.length || jobs.length >= 10} onClick={() => void perform(async () => {
            const selected = parsePageRange(range, pages.length).map(i => pages[i]);
            const bytes = await exportPdf(selected);
            await api('/jobs?name=' + encodeURIComponent(name), { method: 'POST',
              headers: { 'Content-Type': 'application/pdf' }, body: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) });
            setNotice('Uploaded. OCR runs in the background; you can close this dialog and keep editing.');
            await refresh();
          })}>{busy ? 'Please wait…' : 'Upload edited PDF & start OCR'}</Button>
          <div className="ocr-jobs" aria-label="Saved OCR jobs">
            {!jobs.length && <p className="muted">Your searchable PDFs will appear here.</p>}
            {jobs.map(job => <article className="ocr-job" key={job.id}>
              <strong>{job.name}</strong><span>{job.status} · {new Date(job.created_at).toLocaleString()}</span>
              {job.error && <p>{job.error}</p>}
              <div className="row">{job.status === 'completed' && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
                const response = await api('/jobs/' + job.id + '/download');
                download(new Uint8Array(await response.arrayBuffer()), job.name + '-searchable.pdf', 'application/pdf');
              })}>Download searchable PDF</Button>}
                <Button variant="ghost" disabled={busy} onClick={() => void perform(async () => {
                  await api('/jobs/' + job.id, { method: 'DELETE' }); await refresh();
                })}>Delete</Button></div>
            </article>)}
          </div>
        </>}
        {error && <p role="alert" className="export-error">{error}</p>}
        {notice && <output>{notice}</output>}
      </DialogContent>
    </Dialog>
  </>;
}

