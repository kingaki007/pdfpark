import io
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

from pypdf import PdfReader
from db import connect, initialize
import storage


def process(data):
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 200:
        raise ValueError('Unsupported page count or encryption')
    with tempfile.TemporaryDirectory() as directory:
        source, target = Path(directory) / 'input.pdf', Path(directory) / 'output.pdf'
        source.write_bytes(data)
        # Force OCR includes flattened text added by the local editor, even on
        # pages that already contain text. Ordinary local exports stay vector.
        proc = subprocess.Popen(['ocrmypdf', '--force-ocr', '--output-type', 'pdf',
                                 '--optimize', '0', '--jobs', '1', '--language', 'eng',
                                 '--tesseract-timeout', '60', str(source), str(target)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        try:
            if proc.wait(timeout=600) != 0:
                raise ValueError('OCR failed')
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise ValueError('OCR timed out')
        if target.stat().st_size > 80 * 1024 * 1024:
            raise ValueError('Output too large')
        output = target.read_bytes()
        if not any(page.extract_text().strip() for page in PdfReader(io.BytesIO(output)).pages):
            raise ValueError('No readable text detected')
        return output


def run_once():
    with connect() as db:
        stale = db.execute("SELECT id,input_path FROM jobs WHERE status='processing' "
                           "AND started_at<now()-interval '15 minutes' FOR UPDATE").fetchall()
        for job in stale:
            storage.remove(job['input_path'])
            db.execute("UPDATE jobs SET status='failed',input_path=NULL,error='Worker interrupted. Upload again.' "
                       "WHERE id=%s", (job['id'],))
        row = db.execute("SELECT id,input_path FROM jobs WHERE status='queued' ORDER BY created_at "
                         'FOR UPDATE SKIP LOCKED LIMIT 1').fetchone()
        if not row:
            return False
        db.execute("UPDATE jobs SET status='processing',started_at=now() WHERE id=%s", (row['id'],))
    reference = storage.key(row['id'], 'output')
    try:
        output = process(storage.path(row['input_path']).read_bytes())
        with connect() as db:
            # Serialize publication with deletion: deleted jobs cannot recreate files.
            current = db.execute('SELECT status FROM jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
            if current and current['status'] == 'processing':
                storage.write(reference, output)
                db.execute("UPDATE jobs SET status='completed',output_path=%s,input_path=NULL WHERE id=%s",
                           (reference, row['id']))
    except Exception:
        with connect() as db:
            current = db.execute('SELECT status FROM jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
            if current and current['status'] == 'processing':
                storage.remove(reference)
                db.execute("UPDATE jobs SET status='failed',input_path=NULL,error=%s WHERE id=%s",
                           ('OCR could not finish. Use a readable, unencrypted PDF of up to 200 pages; '
                            'large files may exceed the 10-minute limit.', row['id']))
    finally:
        storage.remove(row['input_path'])
    return True

if __name__ == '__main__':
    initialize()
    while True:
        try:
            if not run_once():
                time.sleep(2)
        except Exception:
            # Keep document contents and database credentials out of logs.
            print('Worker database unavailable; retrying.', flush=True)
            time.sleep(5)

