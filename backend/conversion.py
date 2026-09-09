import asyncio
import os
from pathlib import Path
import signal
import sys
import tempfile
from fastapi import APIRouter, HTTPException, Request, Response
from create_pdf import OFFICE, IMAGES

router = APIRouter()
gate = asyncio.Semaphore(1)
TYPES = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}

@router.post('/api/convert')
async def convert(request: Request):
    source = request.query_params.get('source', '')
    target = request.query_params.get('target', '')
    protection = request.query_params.get('protection', 'unlocked')
    if protection not in {'locked', 'unlocked'} or (protection == 'locked' and target != 'pdf'):
        raise HTTPException(422, 'Password protection is available for PDF output only.')
    if not (source == 'pdf' and target in {'docx', 'xlsx', 'pptx'} or source in OFFICE | IMAGES | {'txt', 'md', 'markdown', 'pdf'} and target == 'pdf'):
        raise HTTPException(422, 'Unsupported conversion format.')
    if gate.locked():
        raise HTTPException(429, 'A conversion is running. Please try again shortly.')
    async with gate:
        with tempfile.TemporaryDirectory(prefix='pdf-convert-') as folder:
            root = Path(folder)
            input_file = root / ('input.' + source)
            size = 0
            password = b''
            prefix = bytearray()
            prefix_done = protection != 'locked'
            with input_file.open('wb') as stream:
                async for chunk in request.stream():
                    if not prefix_done:
                        prefix.extend(chunk)
                        if len(prefix) < 4:
                            continue
                        length = int.from_bytes(prefix[:4], 'big')
                        if not 1 <= length <= 40:
                            raise HTTPException(422, 'Use a password of 1–40 UTF-8 bytes.')
                        if len(prefix) < 4 + length:
                            continue
                        password = bytes(prefix[4:4 + length])
                        try:
                            if not password.decode('utf-8').strip():
                                raise ValueError()
                        except (UnicodeDecodeError, ValueError):
                            raise HTTPException(422, 'Enter a valid, non-blank password.')
                        chunk = bytes(prefix[4 + length:])
                        prefix.clear()
                        prefix_done = True
                    size += len(chunk)
                    if size > 40 * 1024 * 1024:
                        raise HTTPException(413, 'Conversion input exceeds 40 MB.')
                    stream.write(chunk)
            if not prefix_done or not size:
                raise HTTPException(422, 'Choose a non-empty document.')
            output = root / ('converted.' + target)
            if target != 'pdf':
                command = [sys.executable, str(Path(__file__).with_name('convert_document.py')), str(input_file), target, str(output)]
            else:
                command = [sys.executable, str(Path(__file__).with_name('create_pdf.py')), str(input_file), str(output)]
            try:
                process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True, env={**os.environ, 'HOME': folder})
            except FileNotFoundError:
                raise HTTPException(503, 'The conversion engine is not installed on this server.')
            try:
                await asyncio.wait_for(process.communicate(password), timeout=45)
            except (TimeoutError, asyncio.CancelledError) as error:
                if process.returncode is None:
                    if os.name == 'posix':
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    await process.wait()
                if isinstance(error, asyncio.CancelledError):
                    raise
                raise HTTPException(408, 'Conversion timed out. Try a smaller document.')
            if process.returncode == 4:
                raise HTTPException(503, 'The conversion engine is not installed on this server.')
            if process.returncode or not output.exists():
                raise HTTPException(422, 'Unable to convert. Check the file is valid and unlocked, with at most 200 pages. Text must be UTF-8 or UTF-16; images must be at most 24 megapixels. Scanned PDFs need OCR before Word/Excel conversion.')
            if output.stat().st_size > 80 * 1024 * 1024:
                raise HTTPException(413, 'Converted document exceeds 80 MB. Try fewer pages.')
            return Response(output.read_bytes(), media_type=TYPES[target], headers={'Content-Disposition': f'attachment; filename="converted.{target}"', 'Cache-Control': 'no-store'})


