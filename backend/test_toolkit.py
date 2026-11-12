from io import BytesIO
from zipfile import ZipFile
import json
import fitz
import pytest
from toolkit_worker import process, page_indices, main


def sample(pages=3):
    doc=fitz.open()
    for i in range(pages):
        page=doc.new_page()
        page.insert_text((50,70),f'PAGE {i+1} Sample document text.')
        page.insert_text((50,100),'Contact alice@example.com')
    doc.set_metadata({'author':'Private author','title':'Test'})
    return doc.tobytes()


def run(op,options=None,files=None):
    return process(op,files or [('test.pdf',sample())],options or {})


def test_ranges_and_split_groups():
    assert page_indices('1,3-4',4)==[0,2,3]
    for bad in ['0','5','3-1','abc','1,,2']:
        with pytest.raises(ValueError):page_indices(bad,4)
    data,_,_=run('split-pdf',{'range':'1-2;3'})
    with ZipFile(BytesIO(data)) as z:
        assert [len(fitz.open(stream=z.read(n),filetype='pdf')) for n in z.namelist()]==[2,1]


@pytest.mark.parametrize('operation,options,count',[
 ('merge-pdf',{},6),('alternate-mix-pdf',{},6),
 ('extract-pdf-pages',{'range':'2'},1),('delete-pdf-pages',{'range':'2'},2),
 ('multiple-pages-per-sheet',{'perSheet':'4'},1),
 ('rotate-pdf',{'range':'2','angle':'90'},3),
 ('crop-resize-pdf',{'margin':'10','paper':'a4'},3),
 ('compress-pdf',{'preset':'lossless'},3),('flatten-pdf',{},3),
 ('invert-pdf',{'colorMode':'sepia'},3),('flip-pdf',{},3),
 ('page-numbers',{'prefix':'Page '},3),('headers-footers',{'text':'Page {page} / {total}'},3),
 ('add-watermark',{'text':'CONFIDENTIAL','angle':'0'},3),('repair-pdf',{},3),
])
def test_document_operations(operation,options,count):
    files=[('test.pdf',sample())]
    if operation in {'merge-pdf','alternate-mix-pdf'}:files.append(('second.pdf',sample()))
    data,kind,ext=run(operation,options,files)
    assert kind=='application/pdf' and ext=='pdf'
    with fitz.open(stream=data,filetype='pdf') as doc:
        assert len(doc)==count
        if operation=='rotate-pdf':assert doc[1].rotation==90 and doc[0].rotation==0
        if operation=='extract-pdf-pages':assert 'PAGE 2' in doc[0].get_text()


def test_redaction_removes_content_and_metadata():
    data,_,_=run('auto-redact-pii')
    with fitz.open(stream=data,filetype='pdf') as doc:
        assert all('alice@example.com' not in p.get_text() for p in doc)
        assert not doc.metadata.get('author')
        assert any('Sample document' in p.get_text() for p in doc)


def test_password_round_trip():
    data,_,_=run('encrypt-pdf',{'newPassword':'secure-test'})
    with fitz.open(stream=data,filetype='pdf') as doc:assert doc.needs_pass
    with pytest.raises(ValueError):process('remove-password',[('locked.pdf',data)],{'password':'wrong'})
    unlocked,_,_=process('remove-password',[('locked.pdf',data)],{'password':'secure-test'})
    with fitz.open(stream=unlocked,filetype='pdf') as doc:assert not doc.needs_pass and len(doc)==3


@pytest.mark.parametrize('operation,ext',[('extract-text','txt'),('pdf-to-html','html'),('pdf-to-epub','epub'),('pdf-to-jpg','jpg'),('pdf-to-png','png'),('pdf-to-tiff','tiff')])
def test_export(operation,ext):
    data,_,actual=run(operation,{'range':'2','dpi':'72'})
    assert actual==ext and len(data)>50
    if ext=='epub':
        with ZipFile(BytesIO(data)) as z:
            assert z.namelist()[0]=='mimetype'
            assert b'PAGE 2' in z.read('text.xhtml')
    if ext in {'txt','html'}:assert b'PAGE 2' in data and b'PAGE 1' not in data


def test_split_size_limit():
    data,_,_=run('split-pdf-by-size',{'maxMB':'.05'})
    with ZipFile(BytesIO(data)) as z:assert all(len(z.read(n))<=.05*1024*1024 for n in z.namelist())


def test_privacy_report():
    data,_,_=run('privacy-scanner')
    report=json.loads(data)
    assert report['metadata']['author']=='Private author'
    assert any(x['text']=='alice@example.com' for x in report['findings'])


def test_redaction_checker_flags_overlay():
    doc=fitz.open(stream=sample(1),filetype='pdf')
    rect=doc[0].search_for('alice@example.com')[0]
    doc[0].draw_rect(rect,fill=(0,0,0))
    data,_,_=run('redaction-checker',files=[('overlay.pdf',doc.tobytes())])
    assert 'alice@example.com' in json.loads(data)['findings'][0]['recoverableText']


def test_worker_rejects_zip_bomb_before_read(tmp_path):
    with ZipFile(tmp_path/'request.zip','w') as z:
        z.writestr('options.json','{}')
        for i in range(202):z.writestr(str(i),'x')
    main('repair-pdf',tmp_path)
    assert 'error' in json.loads((tmp_path/'result.json').read_text())


def test_disabled_subscriptions():
    from subscriptions import get_subscription, SubscriptionUpdate, update_subscription
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:get_subscription('unused')
    assert error.value.status_code==404
    with pytest.raises(HTTPException):update_subscription('unused',SubscriptionUpdate(plan_id='free',status='free'))
