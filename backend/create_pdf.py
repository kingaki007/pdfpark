"""Bounded PDF creation worker. Output passwords arrive only through stdin."""
import html
import io
from pathlib import Path
import secrets
import subprocess
import sys

import fitz
from PIL import Image, ImageOps

OFFICE = {'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'}
IMAGES = {'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'}


def create_pdf(source, output, password=''):
    source, output = Path(source), Path(output)
    kind = source.suffix.lower()[1:]
    if password and (not password.strip() or len(password.encode('utf-8')) > 40):
        raise ValueError('Use a password of 1–40 UTF-8 bytes.')
    intermediate = source.parent / 'rendered.pdf'
    if kind in OFFICE:
        rendered = source.parent / 'office'
        rendered.mkdir()
        subprocess.run([
            'libreoffice', '-env:UserInstallation=' + (source.parent / 'profile').as_uri(),
            '--headless', '--convert-to', 'pdf', '--outdir', str(rendered), str(source),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        intermediate = rendered / (source.stem + '.pdf')
    elif kind in {'txt', 'md', 'markdown'}:
        raw = source.read_bytes()
        text = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
        if '\x00' in text:
            raise ValueError('Upload UTF-8 or UTF-16 text.')
        # Escape all uploaded content: text must never load HTML resources.
        content = ''.join('<p>' + html.escape(line.expandtabs(4)) + '</p>' for line in text.splitlines())
        css = 'p { margin: 0; white-space: pre-wrap; font-size: 11pt; }'
        if kind in {'md', 'markdown'}:
            from markdown_pdf import render_markdown, CSS
            content, css = render_markdown(text), CSS
        story = fitz.Story(html=content or '<p>&nbsp;</p>', user_css=css)
        rect = fitz.paper_rect('a4')
        with fitz.DocumentWriter(str(intermediate)) as writer:
            more = True
            pages = 0
            while more:
                if pages >= 200:
                    raise ValueError('PDF exceeds 200 pages.')
                device = writer.begin_page(rect)
                more, _ = story.place(rect + (36, 36, -36, -36))
                story.draw(device)
                writer.end_page()
                pages += 1
    elif kind in IMAGES:
        with Image.open(source) as image, fitz.open() as doc:
            frames = getattr(image, 'n_frames', 1)
            if frames > 200:
                raise ValueError('Image exceeds 200 frames/pages.')
            for index in range(frames):
                image.seek(index)
                if image.width * image.height > 24_000_000:
                    raise ValueError('Image exceeds 24 megapixels.')
                frame = ImageOps.exif_transpose(image).convert('RGB')
                data = io.BytesIO()
                frame.save(data, format='PNG')
                page = doc.new_page(width=595, height=842)
                page.insert_image(page.rect + (36, 36, -36, -36), stream=data.getvalue())
            doc.save(intermediate)
    elif kind == 'pdf':
        intermediate = source
    else:
        raise ValueError('Unsupported file format.')
    with fitz.open(intermediate) as doc:
        if not doc.is_pdf or doc.needs_pass or not 0 < doc.page_count <= 200:
            raise ValueError('Use an unlocked document with 1–200 pages. Unlock protected PDFs first.')
        options = dict(encryption=fitz.PDF_ENCRYPT_NONE)
        if password:
            options = dict(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=secrets.token_hex(20))
        doc.save(output, deflate=True, **options)


if __name__ == '__main__':
    try:
        create_pdf(sys.argv[1], sys.argv[2], sys.stdin.buffer.read(161).decode('utf-8'))
    except FileNotFoundError:
        sys.exit(4)
    except Exception:
        sys.exit(1)

