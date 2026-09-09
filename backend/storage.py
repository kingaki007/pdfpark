"""Private server-side document storage shared by the API and OCR worker."""
import os
from pathlib import Path
import tempfile
import uuid


def root():
    folder = Path(os.environ.get('DOCUMENT_STORAGE_DIR', str(Path(__file__).resolve().parent.parent / '.data' / 'documents'))).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def key(job_id, kind):
    if kind not in {'input', 'output'}:
        raise ValueError('Invalid document kind')
    return f'{uuid.UUID(str(job_id))}/{kind}.pdf'


def path(reference):
    # Only application-generated relative keys are accepted, never user filenames.
    parts = reference.split('/')
    if len(parts) != 2 or reference != key(parts[0], parts[1].removesuffix('.pdf')):
        raise ValueError('Invalid document reference')
    folder = root()
    result = (folder / reference).resolve()
    if not result.is_relative_to(folder):
        raise ValueError('Document reference escapes storage')
    return result


def write(reference, data):
    target = path(reference)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        # Persist the directory entry before committing the database reference.
        if os.name == 'posix':
            descriptor = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def remove(reference):
    if reference:
        target = path(reference)
        target.unlink(missing_ok=True)
        try:
            target.parent.rmdir()
        except OSError:
            pass

