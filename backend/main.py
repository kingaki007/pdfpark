import hashlib
import hmac
import os
import re
import secrets
import uuid
import storage
from contextlib import asynccontextmanager

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from db import connect, initialize
from conversion import router as conversion_router
from unlock import router as unlock_router

MAX_BYTES = 40 * 1024 * 1024
COOKIE = 'pdf_session'


@asynccontextmanager
async def lifespan(app):
    initialize()
    from admin import seed_root
    seed_root()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(conversion_router)
app.include_router(unlock_router)


@app.middleware('http')
async def security(request: Request, call_next):
    # A custom header cannot be sent by cross-origin HTML forms. No CORS is enabled.
    if request.method in {'POST', 'DELETE', 'PUT', 'PATCH'}:
        if request.headers.get('x-pdf-studio') != '1' or request.headers.get('sec-fetch-site') == 'cross-site':
            return Response('Request origin rejected', status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return salt + ':' + result.hex()


def verify_password(password, encoded):
    return hmac.compare_digest(hash_password(password, encoded.split(':')[0]), encoded)


def user(request: Request):
    with connect() as db:
        row = db.execute('SELECT u.id, u.email, u.is_root FROM users u JOIN sessions s ON s.user_id=u.id '
                         'WHERE s.token=%s AND s.expires_at>now()',
                         (digest(request.cookies.get(COOKIE, '')),)).fetchone()
    if not row:
        raise HTTPException(401, 'Sign in to use server OCR.')
    return row


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)


def auth_limit(request):
    key = digest(request.client.host if request.client else 'unknown')
    with connect() as db:
        db.execute('DELETE FROM auth_limits WHERE expires_at<now()')
        row = db.execute("INSERT INTO auth_limits VALUES (%s, 1, now()+interval '15 minutes') "
                         'ON CONFLICT (key) DO UPDATE SET attempts=auth_limits.attempts+1 RETURNING attempts',
                         (key,)).fetchone()
    if row['attempts'] > 30:
        raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')


def start_session(db, user_id, response, request):
    token = secrets.token_urlsafe(32)
    db.execute('DELETE FROM sessions WHERE expires_at<now() OR token=%s',
               (digest(request.cookies.get(COOKIE, '')),))
    db.execute("INSERT INTO sessions VALUES (%s,%s,now()+interval '7 days')", (digest(token), user_id))
    response.set_cookie(COOKIE, token, httponly=True, samesite='strict',
                        secure=os.getenv('COOKIE_SECURE', 'true') == 'true', max_age=604800, path='/api')


@app.post('/api/auth/register', status_code=201)
def register(data: Credentials, request: Request, response: Response):
    auth_limit(request)
    email = data.email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'Enter a valid email address.')
    user_id = uuid.uuid4()
    try:
        with connect() as db:
            db.execute('INSERT INTO users(id,email,password) VALUES (%s,%s,%s)', (user_id, email, hash_password(data.password)))
            start_session(db, user_id, response, request)
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, 'Unable to register this email. Try signing in.')
    return {'email': email}


@app.post('/api/auth/login')
def login(data: Credentials, request: Request, response: Response):
    auth_limit(request)
    with connect() as db:
        row = db.execute('SELECT * FROM users WHERE email=%s', (data.email.strip().lower(),)).fetchone()
        encoded = row['password'] if row else hash_password('dummy-password')
        if not verify_password(data.password, encoded) or not row:
            raise HTTPException(401, 'Email or password is incorrect.')
        start_session(db, row['id'], response, request)
    return {'email': row['email']}


@app.get('/api/auth/me')
def me(current=Depends(user)):
    return {'email': current['email'], 'is_root': current['is_root']}


@app.post('/api/auth/logout', status_code=204)
def logout(request: Request, response: Response):
    with connect() as db:
        db.execute('DELETE FROM sessions WHERE token=%s', (digest(request.cookies.get(COOKIE, '')),))
    response.delete_cookie(COOKIE, path='/api')


@app.get('/api/healthz')
def health():
    with connect() as db:
        db.execute('SELECT 1')
    return {'status': 'ok'}


@app.post('/api/jobs', status_code=202)
async def create_job(request: Request, current=Depends(user)):
    if request.headers.get('content-type', '').split(';')[0] != 'application/pdf':
        raise HTTPException(415, 'Upload a PDF.')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, 'The edited PDF exceeds the 40 MB server limit.')
    # Parsing and rendering untrusted PDFs is isolated in the worker.
    if not data.startswith(b'%PDF-'):
        raise HTTPException(422, 'Invalid PDF header.')
    name = request.query_params.get('name', 'document')
    name = re.sub(r'[^\w .-]', '', name)[:100].strip(' .') or 'document'
    job_id = uuid.uuid4()
    reference = storage.key(job_id, 'input')
    try:
        with connect() as db:
            if not db.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (current['id'],)).fetchone():
                raise HTTPException(401, 'Account no longer exists.')
            count = db.execute('SELECT count(*) AS n FROM jobs WHERE user_id=%s', (current['id'],)).fetchone()['n']
            if count >= 10:
                raise HTTPException(409, 'Your library is full (10 documents). Delete a job before uploading.')
            storage.write(reference, data)
            db.execute('INSERT INTO jobs(id,user_id,name,input_path) VALUES (%s,%s,%s,%s)',
                       (job_id, current['id'], name, reference))
    except BaseException:
        storage.remove(reference)
        raise
    return {'id': str(job_id)}


@app.get('/api/jobs')
def jobs(current=Depends(user)):
    with connect() as db:
        return db.execute('SELECT id,name,status,created_at,error FROM jobs WHERE user_id=%s '
                          'ORDER BY created_at DESC', (current['id'],)).fetchall()


def owned(db, job_id, current):
    row = db.execute('SELECT id,name,status,input_path,output_path FROM jobs WHERE id=%s AND user_id=%s FOR UPDATE',
                     (job_id, current['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'Document not found.')
    return row


@app.get('/api/jobs/{job_id}/download')
def download(job_id: uuid.UUID, current=Depends(user)):
    with connect() as db:
        row = owned(db, job_id, current)
        if row['status'] != 'completed':
            raise HTTPException(409, 'OCR is not complete.')
        try:
            data = storage.path(row['output_path']).read_bytes() if row['output_path'] else None
        except FileNotFoundError:
            data = None
        if data is None:
            raise HTTPException(404, 'Document file not found.')
    return Response(data, media_type='application/pdf',
                    headers={'Content-Disposition': 'attachment; filename="searchable.pdf"'})

@app.delete('/api/jobs/{job_id}', status_code=204)
def delete(job_id: uuid.UUID, current=Depends(user)):
    with connect() as db:
        row = owned(db, job_id, current)
        storage.remove(row['input_path'])
        storage.remove(row['output_path'])
        db.execute('DELETE FROM jobs WHERE id=%s AND user_id=%s', (job_id, current['id']))





from admin import router as admin_router
app.include_router(admin_router)


from visitors import router as visitors_router
app.include_router(visitors_router)
