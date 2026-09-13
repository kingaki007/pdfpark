import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/server-api";
import { download, MAX_FILE_SIZE } from "@/lib/pdf-engine";

export function UnlockPdf({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function unlock() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error("Choose a PDF no larger than 40 MB.");
      const secret = new TextEncoder().encode(password);
      if (secret.length > 4096) throw new Error("Password is too long.");
      const prefix = new Uint8Array(4);
      new DataView(prefix.buffer).setUint32(0, secret.length);
      const response = await api("/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Blob([prefix, secret, file]),
      });
      download(
        new Uint8Array(await response.arrayBuffer()),
        file.name.replace(/\.pdf$/i, "") + "-unlocked.pdf",
        "application/pdf",
      );
      setPassword("");
      setNotice(
        "Unlocked PDF downloaded without password protection. Use Open file to edit the downloaded copy.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unlock failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Unlock PDF
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setPassword("");
            setFile(null);
            setError("");
            setNotice("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock PDF</DialogTitle>
            <DialogDescription>
              Enter the PDF password to download a copy without password protection.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            className="grid gap-4"
          >
            <label className="form-label">
              Locked PDF
              <input
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setPassword("");
                  setError("");
                  setNotice("");
                }}
              />
            </label>
            <label className="form-label">
              PDF password
              <input
                type="password"
                autoComplete="off"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="muted">
              Unlock &amp; export uploads this PDF and password to the server. Temporary files are
              deleted after processing. Up to 40 MB and 200 pages. Leave the password blank if the
              PDF opens without one.
            </p>
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            <Button type="submit" disabled={!file || busy}>
              {busy ? "Unlocking…" : "Unlock & export"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
