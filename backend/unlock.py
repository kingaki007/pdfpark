import asyncio
from pathlib import Path
import sys
import tempfile
from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter()
gate = asyncio.Semaphore(1)

@router.post('/api/unlock')
async def unlock(request: Request):
    if request.headers.get('content-type') != 'application/octet-stream':
        raise HTTPException(415, 'Upload a PDF using Unlock PDF.')
    if gate.locked():
        raise HTTPException(429, 'Another PDF is being unlocked. Try again shortly.')
    async with gate:
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 40 * 1024 * 1024 + 4100:
                raise HTTPException(413, 'PDF exceeds 40 MB.')
        length = int.from_bytes(data[:4], 'big')
        if len(data) < 4 or length > 4096 or len(data) <= 4 + length:
            raise HTTPException(422, 'Invalid unlock request.')
        password = bytes(data[4:4 + length])
        pdf = data[4 + length:]
        if len(pdf) > 40 * 1024 * 1024:
            raise HTTPException(413, 'PDF exceeds 40 MB.')
        if b'%PDF-' not in pdf[:1024]:
            raise HTTPException(422, 'Choose a valid PDF.')
        with tempfile.TemporaryDirectory(prefix='pdf-unlock-') as folder:
            source, target = Path(folder) / 'input.pdf', Path(folder) / 'unlocked.pdf'
            source.write_bytes(pdf)
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(Path(__file__).with_name('unlock_pdf.py')), str(source), str(target),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            try:
                await asyncio.wait_for(process.communicate(password), timeout=45)
            except (TimeoutError, asyncio.CancelledError) as error:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
                if isinstance(error, asyncio.CancelledError):
                    raise
                raise HTTPException(408, 'Unlock timed out. Try a smaller PDF.')
            if process.returncode == 2:
                raise HTTPException(422, 'Incorrect PDF password. Please try again.')
            if process.returncode == 3:
                raise HTTPException(422, 'PDF exceeds the 200-page limit.')
            if process.returncode or not target.exists():
                raise HTTPException(422, 'Unable to unlock this PDF. Check the file and password.')
            if target.stat().st_size > 80 * 1024 * 1024:
                raise HTTPException(413, 'Unlocked PDF exceeds 80 MB.')
            return Response(target.read_bytes(), media_type='application/pdf', headers={
                'Content-Disposition': 'attachment; filename="unlocked.pdf"', 'Cache-Control': 'no-store'})
