"""Count browser visits without IP, location, fingerprint, or account linkage."""
import hashlib
import os
import re
import secrets
from fastapi import APIRouter, Request, Response
from db import connect

router = APIRouter()
COOKIE = 'pdf_visitor'

@router.post('/api/visit', status_code=204)
def visit(request: Request, response: Response):
    token = request.cookies.get(COOKIE, '')
    if not re.fullmatch(r'[a-f0-9]{64}', token):
        token = secrets.token_hex(32)
    identifier = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        db.execute("""INSERT INTO visitors(visitor_hash) VALUES (%s)
            ON CONFLICT(visitor_hash) DO UPDATE SET
            visits=visitors.visits+1, last_seen=now()""", (identifier,))
    response.set_cookie(COOKIE, token, max_age=365*24*60*60, httponly=True,
                        samesite='strict', secure=os.getenv('COOKIE_SECURE', 'true') == 'true', path='/api')

