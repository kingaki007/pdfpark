"""Document operations isolated by toolkit.py. No remote resources are loaded."""
import csv
import hashlib
import html
import io
import json
import math
import re
import secrets
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED
import fitz
from PIL import Image, ImageOps

MAX_BYTES = 40 * 1024 * 1024
PII = {
    'Email': r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',
    'PAN': r'\b[A-Z]{5}[0-9]{4}[A-Z]\b',
    'Aadhaar-like number': r'\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b',
    'Phone / card-like number': r'(?<!\w)(?:\+?[0-9][ -]?){10,16}(?!\w)',
}


def page_indices(value, count):
    if not str(value).strip():
        return list(range(count))
    result = []
    for part in str(value).split(','):
        if not re.fullmatch(r'\s*\d+\s*(?:-\s*\d+\s*)?', part):
            raise ValueError('Use page numbers or ranges, for example 1,3-5.')
        ends = [int(x) for x in part.split('-')]
        start, end = ends[0], ends[-1]
        if not 1 <= start <= end <= count:
            raise ValueError(f'Page ranges must be between 1 and {count}.')
        for n in range(start - 1, end):
            if n not in result:
                result.append(n)
    return result


def number(options, key, default, low, high):
    value = float(options.get(key, default))
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{key} must be between {low} and {high}.')
    return value


def load_pdf(data, password=''):
    doc = fitz.open(stream=data, filetype='pdf')
    if doc.needs_pass and not doc.authenticate(password):
        raise ValueError('The password is missing or incorrect.')
    if not 0 < len(doc) <= 200:
        raise ValueError('Choose a document with 1–200 pages.')
    for page in doc:
        if max(page.rect.width, page.rect.height) > 14400:
            raise ValueError('The page dimensions are too large.')
    return doc


def pdf_bytes(doc):
    if not len(doc):
        raise ValueError('The result would contain no pages.')
    return doc.tobytes(garbage=4, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)


def pack(entries):
    output = io.BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as z:
        for name, data in entries:
            z.writestr(name, data)
    return output.getvalue(), 'application/zip', 'zip'


def render_html(content):
    # Never pass an Archive or network loader: external HTML resources cannot resolve.
    content = re.sub(r'<(script|iframe|object|embed)\b[^>]*>.*?</\1\s*>', '', content, flags=re.I | re.S)
    content = re.sub(r'<(?:img|link|base|iframe|object|embed)\b[^>]*>', '', content, flags=re.I)
    out = io.BytesIO()
    story = fitz.Story(html=content or '<p> </p>', user_css='body{font-family:sans-serif;font-size:11pt} table{border-collapse:collapse} td,th{border:1px solid #ccc;padding:5px} h1{color:#185be8}')
    with fitz.DocumentWriter(out) as writer:
        more, count = True, 0
        while more:
            if count >= 200:
                raise ValueError('Content exceeds 200 pages.')
            rect = fitz.paper_rect('a4')
            device = writer.begin_page(rect)
            more, _ = story.place(rect + (36, 36, -36, -36))
            story.draw(device)
            writer.end_page()
            count += 1
    return out.getvalue()


def result_json(value):
    return json.dumps(value, ensure_ascii=False).encode(), 'application/json', 'json'


def raster(doc, opts, transform=None):
    out = fitz.open()
    dpi = number(opts, 'dpi', 120, 36, 600)
    quality = int(number(opts, 'quality', 75, 15, 100))
    for page in doc:
        scale = min(dpi / 72, 4096 / max(page.rect.width, page.rect.height))
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        if transform:
            image = transform(image)
        buf = io.BytesIO()
        image.save(buf, format='JPEG', quality=quality, optimize=True)
        out.new_page(width=page.rect.width, height=page.rect.height).insert_image(page.rect, stream=buf.getvalue())
    return out


def process(operation, files, opts):
    if operation == 'fingerprint-pdf':
        return result_json({algo: hashlib.new(algo, files[0][1]).hexdigest() for algo in ['sha256', 'sha1', 'md5']})
    if operation == 'pdf-to-zip':
        return pack([(f'{i+1:03}-{Path(name).name}', data) for i, (name, data) in enumerate(files)])
    if operation in {'html-to-pdf', 'create-pdf', 'latex-resume', 'gst-invoice', 'pos-billing'}:
        return render_html(str(opts.get('html', ''))[:2_000_000]), 'application/pdf', 'pdf'
    if operation == 'csv-to-pdf':
        text = files[0][1].decode('utf-8-sig')
        try:
            dialect = csv.Sniffer().sniff(text[:8192])
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(text), dialect))
        if len(rows) > 10000:
            raise ValueError('Use a CSV with at most 10,000 rows.')
        content = '<table>' + ''.join('<tr>' + ''.join('<td>' + html.escape(c) + '</td>' for c in row) + '</tr>' for row in rows) + '</table>'
        return render_html(content), 'application/pdf', 'pdf'
    if operation == 'ebook-to-pdf':
        name, data = files[0]
        ext = Path(name).suffix.lower().lstrip('.')
        if ext in {'txt','html','htm'}:
            text = data.decode('utf-8-sig')
            return render_html('<pre>'+html.escape(text)+'</pre>' if ext=='txt' else text), 'application/pdf', 'pdf'
        if ext not in {'epub','mobi','fb2'}:
            raise ValueError('Choose an EPUB, MOBI, TXT or HTML ebook without DRM.')
        with fitz.open(stream=data, filetype=ext) as ebook:
            if len(ebook)>200:
                raise ValueError('The ebook exceeds 200 pages.')
            return ebook.convert_to_pdf(), 'application/pdf', 'pdf'
    if operation in {'images-to-pdf', 'png-to-pdf', 'scan-to-pdf'}:
        doc = fitz.open()
        for _, data in files:
            with Image.open(io.BytesIO(data)) as image:
                for frame in range(getattr(image, 'n_frames', 1)):
                    if len(doc)>=200 or image.width*image.height>24_000_000:
                        raise ValueError('Images exceed the 200-page or 24-megapixel limit.')
                    image.seek(frame)
                    buf = io.BytesIO()
                    ImageOps.exif_transpose(image).convert('RGB').save(buf, 'PNG')
                    p = doc.new_page(width=595, height=842)
                    p.insert_image(p.rect + (24,24,-24,-24),stream=buf.getvalue())
        return pdf_bytes(doc),'application/pdf','pdf'
    if not files:
        raise ValueError('Choose at least one document.')
    docs = [load_pdf(data, str(opts.get('password',''))) for name,data in files if name.lower().endswith('.pdf')]
    if not docs:
        raise ValueError('Choose a PDF document.')
    doc = docs[0]
    if sum(len(d) for d in docs)>200:
        raise ValueError('Choose at most 200 pages in total.')
    selected = page_indices('' if operation=='split-pdf' else opts.get('range',''),len(doc))
    if operation in {'merge-pdf','alternate-mix-pdf'}:
        out = fitz.open()
        if operation=='merge-pdf':
            for d in docs: out.insert_pdf(d)
        else:
            for i in range(max(len(d) for d in docs)):
                for d in docs:
                    if i<len(d): out.insert_pdf(d,from_page=i,to_page=i)
        return pdf_bytes(out),'application/pdf','pdf'
    if operation == 'inspect-pdf':
        fields=[]
        for i,p in enumerate(doc):
            for w in p.widgets() or []:
                fields.append({'name':w.field_name,'value':w.field_value,'type':w.field_type_string,'page':i+1,'choices':w.choice_values or []})
        return result_json({'metadata':doc.metadata,'fields':fields,'pages':len(doc),'text':'\n\n'.join(p.get_text(sort=True) for p in doc)[:500000]})
    if operation=='fill-pdf-form':
        from pypdf import PdfReader, PdfWriter
        reader=PdfReader(io.BytesIO(files[0][1]))
        if reader.is_encrypted: reader.decrypt(str(opts.get('password','')))
        writer=PdfWriter(clone_from=reader)
        fields=opts.get('fields',{})
        for page in writer.pages:
            writer.update_page_form_field_values(page,fields,auto_regenerate=False)
        out=io.BytesIO();writer.write(out)
        if opts.get('flatten'):
            return pdf_bytes(raster(load_pdf(out.getvalue()),opts)),'application/pdf','pdf'
        return out.getvalue(),'application/pdf','pdf'
    if operation=='edit-pdf-metadata':
        metadata={k:str(opts.get(k,''))[:500] for k in ['title','author','subject','keywords']}
        doc.set_metadata(metadata)
    elif operation in {'pdf-size-analyzer','privacy-scanner','redaction-checker'}:
        findings=[]
        for i,p in enumerate(doc):
            text=p.get_text()
            if operation=='privacy-scanner':
                for kind,pattern in PII.items():
                    for match in re.finditer(pattern,text): findings.append({'page':i+1,'type':kind,'text':match.group()})
            elif operation=='redaction-checker':
                for drawing in p.get_drawings():
                    fill=drawing.get('fill')
                    if fill and max(fill)<.25:
                        text_under=p.get_textbox(drawing['rect']).strip()
                        if text_under: findings.append({'page':i+1,'recoverableText':text_under})
                for annot in p.annots() or []:
                    if annot.type[0]==fitz.PDF_ANNOT_REDACT: findings.append({'page':i+1,'warning':'Unapplied redaction annotation'})
            else:
                findings.append({'page':i+1,'width':round(p.rect.width),'height':round(p.rect.height),'images':len(p.get_images()),'fonts':len(p.get_fonts()),'characters':len(text)})
        return result_json({'pages':len(doc),'bytes':len(files[0][1]),'metadata':doc.metadata,'findings':findings,'note':'Heuristic inspection; no findings does not prove a document contains no sensitive information.'})
    elif operation in {'redact-pdf','auto-redact-pii'}:
        phrases=[x.strip() for x in str(opts.get('text','')).splitlines() if x.strip()]
        if operation=='redact-pdf' and not phrases: raise ValueError('Enter text to permanently remove.')
        found=0
        for i in selected:
            p=doc[i]
            terms=phrases if operation=='redact-pdf' else [m.group() for pattern in PII.values() for m in re.finditer(pattern,p.get_text())]
            for term in terms:
                for rect in p.search_for(term):
                    p.add_redact_annot(rect,fill=(0,0,0));found+=1
            p.apply_redactions(images=2,graphics=2,text=0)
        if not found: raise ValueError('No matching selectable text was found. Scans need OCR first.')
        doc.set_metadata({})
        doc.del_xml_metadata()
        for name in doc.embfile_names(): doc.embfile_del(name)
    elif operation in {'extract-pdf-pages','delete-pdf-pages'}:
        if opts.get('blank') and operation=='delete-pdf-pages':
            selected=[]
            for i,p in enumerate(doc):
                pix=p.get_pixmap(matrix=fitz.Matrix(.15,.15),colorspace=fitz.csGRAY)
                if not p.get_text().strip() and sum(x<245 for x in pix.samples)/max(1,len(pix.samples))<.001: selected.append(i)
        keep=selected if operation=='extract-pdf-pages' else [i for i in range(len(doc)) if i not in selected]
        if not keep: raise ValueError('Keep at least one page.')
        doc.select(keep)
    elif operation in {'split-pdf','split-pdf-by-text','split-pdf-by-bookmarks','split-pdf-in-half','split-pdf-by-size','gst-filing-prep'}:
        if operation=='split-pdf-in-half' and opts.get('splitMode')=='slice':
            out=fitz.open()
            for i in selected:
                p=doc[i];r=p.rect
                for rect in [fitz.Rect(0,0,r.width/2,r.height),fitz.Rect(r.width/2,0,r.width,r.height)]:
                    target=out.new_page(width=rect.width,height=rect.height);target.show_pdf_page(target.rect,doc,i,clip=rect)
            return pdf_bytes(out),'application/pdf','pdf'
        ranges=[]
        if operation=='split-pdf':
            raw=str(opts.get('range','')).strip()
            ranges=[page_indices(x,len(doc)) for x in raw.split(';')] if raw else [[i] for i in range(len(doc))]
        elif operation in {'split-pdf-by-size','gst-filing-prep'}:
            if operation=='gst-filing-prep': doc=raster(doc,{'dpi':100,'quality':65})
            limit=number(opts,'maxMB',5,.05,40)*1024*1024
            group=[]
            for i in range(len(doc)):
                test=fitz.open()
                for n in group+[i]: test.insert_pdf(doc,from_page=n,to_page=n)
                if len(pdf_bytes(test))>limit:
                    if not group: raise ValueError('A single page exceeds the size limit. Compress it first.')
                    ranges.append(group);group=[i]
                    single=fitz.open();single.insert_pdf(doc,from_page=i,to_page=i)
                    if len(pdf_bytes(single))>limit: raise ValueError('A single page exceeds the size limit. Compress it first.')
                else: group.append(i)
            if group:ranges.append(group)
        else:
            starts=[0]
            if operation=='split-pdf-by-text':
                phrase=str(opts.get('text','')).strip()
                if not phrase: raise ValueError('Enter the phrase that starts a new section.')
                starts += [i for i,p in enumerate(doc) if i and phrase.casefold() in p.get_text().casefold()]
            elif operation=='split-pdf-by-bookmarks':
                starts += [row[2]-1 for row in doc.get_toc() if row[0]==1 and 0<row[2]<=len(doc)]
                if not doc.get_toc():raise ValueError('This PDF has no bookmarks.')
            else: starts += [max(1,len(doc)//2)]
            starts=sorted(set(x for x in starts if x<len(doc)))+[len(doc)]
            ranges=[list(range(a,b)) for a,b in zip(starts,starts[1:])]
        outputs=[]
        for i,indices in enumerate(ranges):
            out=fitz.open()
            for n in indices: out.insert_pdf(doc,from_page=n,to_page=n)
            outputs.append((f'part-{i+1:03}.pdf',pdf_bytes(out)))
        return pack(outputs)
    elif operation=='rotate-pdf':
        angle=int(number(opts,'angle',90,0,270))
        if angle%90: raise ValueError('Choose 0, 90, 180 or 270 degrees.')
        for i in selected: doc[i].set_rotation((doc[i].rotation+angle)%360)
    elif operation=='crop-resize-pdf':
        margin=number(opts,'margin',18,0,1000)
        size=str(opts.get('paper','original'))
        for i in selected:
            page=doc[i];box=page.cropbox
            if margin*2>=min(box.width,box.height):raise ValueError('Margins would remove the entire page.')
            page.set_cropbox(box+(margin,margin,-margin,-margin))
        if size!='original':
            if size not in {'a4','letter','a3','legal'}:raise ValueError('Choose a supported paper size.')
            out=fitz.open()
            for i,p in enumerate(doc):
                rect=fitz.paper_rect(size) if i in selected else p.rect
                out.new_page(width=rect.width,height=rect.height).show_pdf_page(rect,doc,i)
            doc=out
    elif operation=='multiple-pages-per-sheet':
        count=int(number(opts,'perSheet',4,2,16))
        if count not in {2,4,6,9,16}:raise ValueError('Choose 2, 4, 6, 9 or 16 pages.')
        columns=math.ceil(math.sqrt(count));rows=math.ceil(count/columns);out=fitz.open()
        for start in range(0,len(selected),count):
            p=out.new_page(width=842,height=595)
            for cell,i in enumerate(selected[start:start+count]):
                w,h=p.rect.width/columns,p.rect.height/rows
                rect=fitz.Rect((cell%columns)*w,(cell//columns)*h,(cell%columns+1)*w,(cell//columns+1)*h)
                p.show_pdf_page(rect+(6,6,-6,-6),doc,i)
        doc=out
    elif operation in {'compress-pdf','flatten-pdf','invert-pdf','flip-pdf'}:
        transform=None
        if operation=='compress-pdf' and opts.get('preset','medium')=='lossless':pass
        else:
            if operation=='compress-pdf':
                dpi,quality={'light':(150,85),'medium':(110,70),'heavy':(72,45)}.get(opts.get('preset','medium'),(110,70));opts={**opts,'dpi':dpi,'quality':quality}
            if operation=='invert-pdf':
                mode=opts.get('colorMode','dark')
                transform=lambda im:ImageOps.invert(im) if mode=='dark' else ImageOps.colorize(ImageOps.grayscale(im),'#382515','#f4e5c5') if mode=='sepia' else ImageOps.grayscale(im).convert('RGB')
            if operation=='flip-pdf': transform=lambda im:ImageOps.flip(im) if opts.get('direction')=='vertical' else ImageOps.mirror(im)
            doc=raster(doc,opts,transform)
    elif operation in {'add-watermark','page-numbers','bates-numbering','headers-footers'}:
        start=int(number(opts,'start',1,0,999999999))
        opacity=number(opts,'opacity',.25,.01,1)
        size=number(opts,'fontSize',12,6,160)
        prefix=str(opts.get('prefix',''))[:100]
        counter=start
        watermark=next((data for name,data in files if not name.lower().endswith('.pdf')),None)
        outputs=[]
        for d in (docs if operation=='bates-numbering' else [doc]):
            for i in (list(range(len(d))) if operation=='bates-numbering' else selected):
                p=d[i];r=p.rect
                if operation=='add-watermark':
                    if watermark:
                        with Image.open(io.BytesIO(watermark)) as image:
                            if image.width*image.height>24_000_000:raise ValueError('Watermark image is too large.')
                            im=image.convert('RGBA');im.putalpha(im.getchannel('A').point(lambda x:int(x*opacity)));buf=io.BytesIO();im.save(buf,'PNG')
                            p.insert_image(fitz.Rect(r.width*.2,r.height*.35,r.width*.8,r.height*.65),stream=buf.getvalue())
                    else:
                        text=str(opts.get('text','CONFIDENTIAL'))[:200]
                        p.insert_textbox(fitz.Rect(20,r.height/2-50,r.width-20,r.height/2+100),text,fontsize=max(18,size),align=1,fill_opacity=opacity,rotate=int(opts.get('angle',0))%360)
                else:
                    text=(prefix+str(counter).zfill(int(opts.get('digits',6)))) if operation=='bates-numbering' else prefix+str(counter)
                    if operation=='headers-footers':text=str(opts.get('text','')).replace('{page}',str(i+1)).replace('{total}',str(len(d)))[:500]
                    y=18 if opts.get('position')=='top' else r.height-32
                    p.insert_textbox(fitz.Rect(24,y,r.width-24,y+30),text,fontsize=size,align=1)
                    counter+=1
            if operation=='bates-numbering':outputs.append((f'bates-{len(outputs)+1}.pdf',pdf_bytes(d)))
        if outputs:return pack(outputs)
    elif operation in {'pdf-to-jpg','pdf-to-png','pdf-to-tiff'}:
        dpi=number(opts,'dpi',150,36,600);entries=[];frames=[]
        for i in selected:
            p=doc[i];scale=min(dpi/72,4096/max(p.rect.width,p.rect.height));pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
            ext='jpg' if operation=='pdf-to-jpg' else 'png'
            if operation=='pdf-to-tiff':
                if len(selected)>25:raise ValueError('TIFF export supports up to 25 pages at a time.')
                frames.append(Image.frombytes('RGB',(pix.width,pix.height),pix.samples))
            else:entries.append((f'page-{i+1:03}.{ext}',pix.tobytes('jpeg' if ext=='jpg' else 'png')))
        if frames:
            out=io.BytesIO();frames[0].save(out,format='TIFF',save_all=True,append_images=frames[1:],compression='tiff_lzw');return out.getvalue(),'image/tiff','tiff'
        if len(entries)==1:return entries[0][1],('image/jpeg' if ext=='jpg' else 'image/png'),ext
        return pack(entries)
    elif operation=='extract-images':
        entries=[];seen=set()
        for i in selected:
            for image in doc[i].get_images():
                xref=image[0]
                if xref in seen:continue
                seen.add(xref);extracted=doc.extract_image(xref)
                if extracted:entries.append((f'image-{xref}.{extracted["ext"]}',extracted['image']))
        if not entries:raise ValueError('This PDF contains no embedded images.')
        return pack(entries)
    elif operation in {'extract-text','pdf-to-html','pdf-to-epub','pdf-to-csv'}:
        texts=[doc[i].get_text(sort=True) for i in selected]
        if operation=='extract-text':return '\n\n'.join(texts).encode(),'text/plain; charset=utf-8','txt'
        if operation=='pdf-to-html':
            content='<!doctype html><html><head><meta charset="utf-8"><title>PDF export</title></head><body>'+''.join('<section><h2>Page '+str(i+1)+'</h2><pre>'+html.escape(t)+'</pre></section>' for i,t in zip(selected,texts))+'</body></html>'
            return content.encode(),'text/html; charset=utf-8','html'
        if operation=='pdf-to-csv':
            entries=[]
            for i in selected:
                for n,table in enumerate(doc[i].find_tables().tables):
                    buffer=io.StringIO();writer=csv.writer(buffer)
                    for row in table.extract():writer.writerow([("'"+str(c)) if str(c).startswith(('=','+','-','@','\t','\r')) else c for c in row])
                    entries.append((f'page-{i+1}-table-{n+1}.csv',buffer.getvalue().encode('utf-8-sig')))
            if not entries:raise ValueError('No tables detected. Run OCR first if the document is scanned.')
            return pack(entries)
        uid=secrets.token_hex(16);out=io.BytesIO()
        with ZipFile(out,'w') as z:
            z.writestr('mimetype','application/epub+zip',compress_type=ZIP_STORED)
            z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr('content.opf',f'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">{uid}</dc:identifier><dc:title>PDF export</dc:title><dc:language>en</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="text"/></spine></package>')
            z.writestr('toc.ncx',f'<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="{uid}"/></head><docTitle><text>PDF export</text></docTitle><navMap><navPoint id="start" playOrder="1"><navLabel><text>Document</text></navLabel><content src="text.xhtml"/></navPoint></navMap></ncx>')
            z.writestr('text.xhtml','<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>PDF export</title></head><body>'+''.join('<h2>Page '+str(i+1)+'</h2><p>'+html.escape(t).replace('\n','<br/>')+'</p>' for i,t in zip(selected,texts))+'</body></html>')
        return out.getvalue(),'application/epub+zip','epub'
    elif operation=='encrypt-pdf':
        password=str(opts.get('newPassword',''))
        if not password or len(password.encode())>40:raise ValueError('Use an output password of 1–40 UTF-8 bytes.')
        return doc.tobytes(garbage=4,deflate=True,encryption=fitz.PDF_ENCRYPT_AES_256,user_pw=password,owner_pw=secrets.token_hex(20)),'application/pdf','pdf'
    elif operation in {'remove-password','unlock-pdf','repair-pdf'}:pass
    else:raise ValueError('Unknown document operation.')
    return pdf_bytes(doc),'application/pdf','pdf'


def main(operation, root):
    root=Path(root)
    try:
        if sys.platform!='win32':
            import resource
            resource.setrlimit(resource.RLIMIT_AS,(1536*1024*1024,1536*1024*1024))
            resource.setrlimit(resource.RLIMIT_FSIZE,(80*1024*1024,80*1024*1024))
        with ZipFile(root/'request.zip') as z:
            infos=z.infolist()
            if len(infos)>202 or sum(x.file_size for x in infos)>MAX_BYTES:
                raise ValueError('The expanded upload exceeds the 40 MB limit.')
            config=json.loads(z.read('options.json'))
            opts=config.get('options',{})
            files=[(str(item['name']),z.read('file-'+str(i))) for i,item in enumerate(config.get('files',[]))]
        data,kind,extension=process(operation,files,opts)
        if len(data)>80*1024*1024:raise ValueError('Output exceeds 80 MB. Try fewer pages.')
        (root/'output').write_bytes(data)
        result={'type':kind,'extension':extension}
    except ValueError as exc:
        result={'error':str(exc)[:400]}
    except Exception:
        result={'error':'Unable to process this document. Check the format, password and options.'}
    (root/'result.json').write_text(json.dumps(result),encoding='utf-8')


if __name__=='__main__':main(sys.argv[1],sys.argv[2])
