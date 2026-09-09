from pathlib import Path
import tempfile
import fitz
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from convert_document import convert


def test_pdf_office_outputs():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source = root / 'source.pdf'
        pdf = fitz.open()
        pdf.new_page().insert_text((72, 72), '=SUM(A1:A2)')
        pdf.new_page().insert_text((72, 72), 'Second page')
        pdf.save(source)
        pdf.close()
        for target in ('docx', 'xlsx', 'pptx'):
            convert(str(source), target, str(root / ('out.' + target)))
        assert 'Second page' in '\n'.join(p.text for p in Document(root / 'out.docx').paragraphs)
        book = load_workbook(root / 'out.xlsx')
        assert book.sheetnames == ['Page 1', 'Page 2']
        assert book.worksheets[0]['A1'].data_type == 's'
        assert book.worksheets[0]['A1'].value == '=SUM(A1:A2)'
        assert len(Presentation(root / 'out.pptx').slides) == 2


def test_blank_pdf_requires_ocr():
    import pytest
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / 'blank.pdf'
        pdf = fitz.open()
        pdf.new_page()
        pdf.save(source)
        pdf.close()
        for target in ('docx', 'xlsx'):
            with pytest.raises(ValueError, match='OCR'):
                convert(str(source), target, str(Path(folder) / ('out.' + target)))


def test_conversion_api_rejects_invalid_formats_and_empty_files():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from conversion import router
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.post('/api/convert?source=exe&target=pdf', content=b'x').status_code == 422
        assert client.post('/api/convert?source=pdf&target=docx', content=b'').status_code == 422


def test_office_pdf_route(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import conversion
    calls = []
    class Process:
        returncode = 0
        async def wait(self):
            return 0
    async def launch(*args, **kwargs):
        calls.append(args)
        root = Path(args[args.index('--outdir') + 1])
        (root / 'input.pdf').write_bytes(b'%PDF-1.7 test')
        return Process()
    monkeypatch.setattr(conversion.asyncio, 'create_subprocess_exec', launch)
    app = FastAPI()
    app.include_router(conversion.router)
    with TestClient(app) as client:
        response = client.post('/api/convert?source=docx&target=pdf', content=b'office fixture')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/pdf'
    assert calls[0][0] == 'libreoffice'
    assert not Path(calls[0][-1]).exists()
