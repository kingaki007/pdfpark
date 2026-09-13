"""Decrypt in an isolated process; password is received over stdin."""

import sys
import pymupdf


def unlock(source, target, password):
    with pymupdf.open(source) as doc:
        if not doc.is_pdf:
            return 1
        if doc.is_encrypted and not doc.authenticate(password):
            return 2
        if doc.page_count > 200:
            return 3
        doc.save(target, encryption=pymupdf.PDF_ENCRYPT_NONE)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(
            unlock(
                sys.argv[1], sys.argv[2], sys.stdin.buffer.read(4097).decode("utf-8")
            )
        )
    except Exception:
        sys.exit(1)
