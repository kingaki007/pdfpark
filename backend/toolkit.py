"""Bounded, ephemeral document tools. Untrusted parsing runs in a child process."""
import asyncio
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from fastapi import APIRouter, HTTPException, Request, Response
from conversion import gate

router = APIRouter()


@router.post('/api/tools/{operation}')
async def process_tool(operation: str, request: Request):
    if not operation.replace('-', '').isalpha() or len(operation) > 50:
        raise HTTPException(422, 'Invalid tool.')
    if gate.locked():
        raise HTTPException(429, 'Another conversion is running. Please try again shortly.')
    async with gate:
        with tempfile.TemporaryDirectory(prefix='pdfpark-tool-') as folder:
            root = Path(folder)
            archive = root / 'request.zip'
            size = 0
            with archive.open('wb') as stream:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 40 * 1024 * 1024:
                        raise HTTPException(413, 'The combined upload exceeds 40 MB.')
                    stream.write(chunk)
            if not size:
                raise HTTPException(422, 'Choose a document first.')
            child = await asyncio.create_subprocess_exec(
                sys.executable, str(Path(__file__).with_name('toolkit_worker.py')),
                operation, str(root), stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL, start_new_session=os.name == 'posix',
            )
            try:
                await asyncio.wait_for(child.wait(), timeout=50)
            except (TimeoutError, asyncio.CancelledError) as exc:
                if child.returncode is None:
                    if os.name == 'posix':
                        os.killpg(child.pid, signal.SIGKILL)
                    else:
                        child.kill()
                    await child.wait()
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise HTTPException(408, 'Processing timed out. Try fewer pages or lower resolution.')
            metadata = root / 'result.json'
            if not metadata.exists():
                raise HTTPException(422, 'Unable to process this file. Try a smaller valid document.')
            result = json.loads(metadata.read_text(encoding='utf-8'))
            if 'error' in result:
                raise HTTPException(422, result['error'])
            output = root / 'output'
            if not output.is_file() or output.stat().st_size > 80 * 1024 * 1024:
                raise HTTPException(413, 'The output exceeds 80 MB. Try fewer pages.')
            return Response(output.read_bytes(), media_type=result['type'], headers={
                'Content-Disposition': f'attachment; filename="result.{result["extension"]}"',
                'Cache-Control': 'no-store',
            })
