"""Root administration for retained user documents."""
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Response
from db import connect
import storage
from main import user, hash_password

router = APIRouter(prefix='/api/admin')


def seed_root():
    email = os.getenv('ROOT_ADMIN_EMAIL', 'root@pdfstudio.local').strip().lower()
    password = os.getenv('ROOT_ADMIN_PASSWORD', 'Pdfs!9vQ2#mL7xR4@kT6z')
    if not 10 <= len(password) <= 128 or '@' not in email:
        raise RuntimeError('Invalid root administrator credentials')
    with connect() as db:
        db.execute('SELECT pg_advisory_xact_lock(7359022)')
        if db.execute('SELECT id FROM users WHERE is_root=true').fetchone():
            return
        # Never promote a pre-existing ordinary account with a matching email.
        if db.execute('SELECT id FROM users WHERE email=%s', (email,)).fetchone():
            raise RuntimeError('Root email belongs to an existing account; choose ROOT_ADMIN_EMAIL')
        db.execute('INSERT INTO users(id,email,password,is_root) VALUES (%s,%s,%s,true)',
                   (uuid.uuid4(), email, hash_password(password)))


def root_user(current=Depends(user)):
    if not current['is_root']:
        raise HTTPException(403, 'Root administrator access required.')
    return current


@router.get('/users')
def list_users(current=Depends(root_user)):
    with connect() as db:
        return db.execute('SELECT u.id,u.email,u.is_root,count(j.id) AS document_count '
                          'FROM users u LEFT JOIN jobs j ON j.user_id=u.id '
                          'GROUP BY u.id ORDER BY u.email').fetchall()


@router.get('/files')
def list_files(current=Depends(root_user)):
    with connect() as db:
        return db.execute('SELECT j.id,j.user_id,u.email,j.name,j.status,j.created_at,j.error, '
                          '(j.input_path IS NOT NULL) AS has_input, '
                          '(j.output_path IS NOT NULL) AS has_output '
                          'FROM jobs j JOIN users u ON u.id=j.user_id ORDER BY j.created_at DESC').fetchall()


@router.get('/files/{job_id}/{kind}')
def download_file(job_id: uuid.UUID, kind: str, current=Depends(root_user)):
    if kind not in {'input', 'output'}:
        raise HTTPException(404, 'File not found.')
    with connect() as db:
        row = db.execute('SELECT input_path,output_path FROM jobs WHERE id=%s FOR UPDATE', (job_id,)).fetchone()
        if not row or not row[kind + '_path']:
            raise HTTPException(404, 'File not found.')
        try:
            data = storage.path(row[kind + '_path']).read_bytes()
        except FileNotFoundError:
            raise HTTPException(404, 'File not found.')
    return Response(data, media_type='application/pdf', headers={
        'Content-Disposition': f'attachment; filename="{job_id}-{kind}.pdf"'})


def remove_files(row):
    storage.remove(row['input_path'])
    storage.remove(row['output_path'])


@router.delete('/files/{job_id}', status_code=204)
def delete_file(job_id: uuid.UUID, current=Depends(root_user)):
    with connect() as db:
        row = db.execute('SELECT input_path,output_path FROM jobs WHERE id=%s FOR UPDATE', (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Document not found.')
        remove_files(row)
        db.execute('DELETE FROM jobs WHERE id=%s', (job_id,))


@router.delete('/users/{user_id}', status_code=204)
def delete_user(user_id: uuid.UUID, current=Depends(root_user)):
    with connect() as db:
        row = db.execute('SELECT is_root FROM users WHERE id=%s FOR UPDATE', (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'User not found.')
        if row['is_root']:
            raise HTTPException(409, 'The root administrator cannot be deleted.')
        rows = db.execute('SELECT input_path,output_path FROM jobs WHERE user_id=%s ORDER BY id FOR UPDATE',
                          (user_id,)).fetchall()
        for document in rows:
            remove_files(document)
        db.execute('DELETE FROM users WHERE id=%s', (user_id,))

@router.get('/visitors')
def visitor_stats(current=Depends(root_user)):
    with connect() as db:
        return db.execute("""SELECT count(*) AS unique_browsers,
            count(*) FILTER (WHERE last_seen >= now()-interval '24 hours') AS active_24h,
            COALESCE(sum(visits),0) AS visits FROM visitors""").fetchone()
