import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unlock import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def fixture_pdf(encrypted=True):
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Preserved text")
    result = doc.tobytes(
        encryption=(
            pymupdf.PDF_ENCRYPT_AES_256 if encrypted else pymupdf.PDF_ENCRYPT_NONE
        ),
        owner_pw="owner-secret",
        user_pw="reader-secret",
    )
    doc.close()
    return result


def request(pdf, password):
    secret = password.encode()
    return client.post(
        "/api/unlock",
        content=len(secret).to_bytes(4, "big") + secret + pdf,
        headers={"Content-Type": "application/octet-stream"},
    )


@pytest.mark.parametrize("password", ["reader-secret", "owner-secret"])
def test_unlock_preserves_text_and_removes_password(password):
    result = request(fixture_pdf(), password)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    with pymupdf.open(stream=result.content, filetype="pdf") as doc:
        assert not doc.is_encrypted
        assert not doc.needs_pass
        assert doc.page_count == 1
        assert "Preserved text" in doc[0].get_text()


@pytest.mark.parametrize("password", ["", "incorrect"])
def test_wrong_password(password):
    result = request(fixture_pdf(), password)
    assert result.status_code == 422
    assert "Incorrect PDF password" in result.json()["detail"]


def test_unprotected_pdf():
    assert request(fixture_pdf(False), "").status_code == 200


def test_invalid_pdf():
    assert request(b"not a PDF", "").status_code == 422


def test_malformed_body():
    assert (
        client.post(
            "/api/unlock",
            content=b"bad",
            headers={"Content-Type": "application/octet-stream"},
        ).status_code
        == 422
    )


def test_page_limit():
    doc = pymupdf.open()
    for _ in range(201):
        doc.new_page()
    assert request(doc.tobytes(), "").status_code == 422
    doc.close()
