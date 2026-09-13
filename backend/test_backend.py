import io
import os
import psycopg
from psycopg import sql
import uuid

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from db import connect
from main import app, hash_password, verify_password
from worker import process, run_once


@pytest.fixture(scope="session", autouse=True)
def isolated_database():
    original = os.environ["DATABASE_URL"]
    test_name = "test_" + uuid.uuid4().hex
    with psycopg.connect(original, autocommit=True) as db:
        db.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(test_name)))
    os.environ["DATABASE_URL"] = original.rsplit("/", 1)[0] + "/" + test_name
    try:
        yield
    finally:
        os.environ["DATABASE_URL"] = original
        with psycopg.connect(original, autocommit=True) as db:
            db.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(test_name)
                )
            )


@pytest.fixture
def clients(monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "false")
    accounts = []
    with TestClient(app) as first, TestClient(app) as second:
        for client in (first, second):
            client.headers["X-PDF-Studio"] = "1"

            email = str(uuid.uuid4()) + "@example.test"
            result = client.post(
                "/api/auth/register",
                json={"email": email, "password": "correct-horse-battery"},
            )
            assert result.status_code == 201
            accounts.append(email)
        yield first, second, accounts
    with connect() as db:
        for email in accounts:
            db.execute("DELETE FROM users WHERE email=%s", (email,))


def pdf_fixture():
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 32 Tf 60 680 Td (SEARCHABLE DOCUMENT 12345) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_passwords():
    encoded = hash_password("correct-horse-battery")
    assert encoded != hash_password("correct-horse-battery")
    assert verify_password("correct-horse-battery", encoded)
    assert not verify_password("incorrect-password", encoded)


def test_auth_and_csrf(clients):
    first, _, accounts = clients
    assert first.get("/api/auth/me").json()["email"] == accounts[0]
    assert (
        first.post("/api/auth/logout", headers={"X-PDF-Studio": ""}).status_code == 403
    )
    assert (
        first.post(
            "/api/auth/logout", headers={"Sec-Fetch-Site": "cross-site"}
        ).status_code
        == 403
    )
    cookie = first.cookies.get("pdf_session")
    assert first.post("/api/auth/logout").status_code == 204
    assert first.get("/api/jobs").status_code == 401
    assert (
        first.get("/api/jobs", headers={"Cookie": "pdf_session=" + cookie}).status_code
        == 401
    )
    assert (
        first.post(
            "/api/auth/login", json={"email": accounts[0], "password": "wrong-password"}
        ).status_code
        == 401
    )
    login = first.post(
        "/api/auth/login",
        json={"email": accounts[0].upper(), "password": "correct-horse-battery"},
    )
    assert login.status_code == 200
    assert "HttpOnly" in login.headers["set-cookie"]
    assert "SameSite=strict" in login.headers["set-cookie"]


def test_jobs_isolation_and_failure(clients):
    first, second, _ = clients
    assert (
        first.post(
            "/api/jobs", content=b"bad", headers={"Content-Type": "text/plain"}
        ).status_code
        == 415
    )
    assert (
        first.post(
            "/api/jobs", content=b"bad", headers={"Content-Type": "application/pdf"}
        ).status_code
        == 422
    )
    result = first.post(
        "/api/jobs?name=sample",
        content=b"%PDF-invalid",
        headers={"Content-Type": "application/pdf"},
    )
    assert result.status_code == 202
    job_id = result.json()["id"]
    assert not second.get("/api/jobs").json()
    assert second.get(f"/api/jobs/{job_id}/download").status_code == 404
    assert second.delete(f"/api/jobs/{job_id}").status_code == 404
    assert first.get(f"/api/jobs/{job_id}/download").status_code == 409
    run_once()
    assert first.get("/api/jobs").json()[0]["status"] == "failed"
    assert first.delete(f"/api/jobs/{job_id}").status_code == 204
    assert first.get("/api/jobs").json() == []


def test_real_ocr_download(clients):
    first, second, _ = clients
    result = first.post(
        "/api/jobs?name=search-test",
        content=pdf_fixture(),
        headers={"Content-Type": "application/pdf"},
    )
    assert result.status_code == 202
    job_id = result.json()["id"]
    assert run_once()
    job = first.get("/api/jobs").json()[0]
    assert job["status"] == "completed", job
    response = first.get(f"/api/jobs/{job_id}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert (
        "SEARCHABLE DOCUMENT 12345"
        in PdfReader(io.BytesIO(response.content)).pages[0].extract_text()
    )
    assert second.get(f"/api/jobs/{job_id}/download").status_code == 404
    with connect() as db:
        assert (
            db.execute("SELECT input_path FROM jobs WHERE id=%s", (job_id,)).fetchone()[
                "input_path"
            ]
            is None
        )


def test_ocr_rejects_empty_document():
    writer = PdfWriter()
    stream = io.BytesIO()
    writer.write(stream)
    with pytest.raises(ValueError):
        process(stream.getvalue())
