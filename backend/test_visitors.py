import hashlib
from contextlib import contextmanager
from fastapi import FastAPI
from fastapi.testclient import TestClient
import visitors


def test_cookie_identity_and_hash_only_storage(monkeypatch):
    writes = []

    class Database:
        def execute(self, query, args):
            writes.append((query, args))

    @contextmanager
    def connect():
        yield Database()

    monkeypatch.setattr(visitors, "connect", connect)
    monkeypatch.setenv("COOKIE_SECURE", "false")
    app = FastAPI()
    app.include_router(visitors.router)
    with TestClient(app) as client:
        first = client.post("/api/visit")
        assert first.status_code == 204
        token = client.cookies.get("pdf_visitor")
        assert len(token) == 64
        assert "HttpOnly" in first.headers["set-cookie"]
        assert "SameSite=strict" in first.headers["set-cookie"]
        assert writes[0][1] == (hashlib.sha256(token.encode()).hexdigest(),)
        client.post("/api/visit")
        assert writes[0][1] == writes[1][1]
        assert "visits=visitors.visits+1" in writes[1][0]
        assert "last_seen=now()" in writes[1][0]
        client.cookies.clear()
        client.post("/api/visit")
        assert writes[2][1] != writes[0][1]
        client.cookies.clear()
        client.cookies.set("pdf_visitor", "invalid")
        client.post("/api/visit")
        assert (
            client.cookies.get("pdf_visitor", domain="testserver.local", path="/api")
            != "invalid"
        )


def test_secure_cookie(monkeypatch):
    class Database:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, *args):
            pass

    monkeypatch.setattr(visitors, "connect", Database)
    monkeypatch.setenv("COOKIE_SECURE", "true")
    app = FastAPI()
    app.include_router(visitors.router)
    with TestClient(app, base_url="https://testserver") as client:
        assert "Secure" in client.post("/api/visit").headers["set-cookie"]
