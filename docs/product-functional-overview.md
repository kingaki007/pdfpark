# PDF Studio MVP — Product Functional Overview

## 1. Product summary

PDF Studio is a browser-based PDF editing and conversion platform with optional server-side OCR and searchable PDF generation. The app is designed for users who need to:

- open and edit PDFs locally in a browser
- add text, images, shapes, and signatures to page content
- merge or rotate pages and export revised documents
- convert PDF, image, and supported Office files to other formats
- unlock protected PDFs and generate searchable OCR PDFs via account-based upload

The product deliberately separates local browser processing from server-backed OCR workflows. Browser edits and exports are kept on the client, while searchable PDF generation relies on explicit account authentication, encrypted session cookies, uploaded files, background job processing, and storage.

---

## 2. Core user flows

### A. Local PDF editing

Users can:

- open PDF files and image files
- navigate pages with thumbnails
- zoom, fit, rotate pages, and reorder page layouts
- add text boxes and imported PDF paragraphs
- edit text properties such as font size, style, color, spacing, and indentation
- insert shapes and images
- add handwritten signatures or upload a signature image
- move, resize, and delete objects on the page
- undo and redo edits using Ctrl/Cmd+Z and Ctrl/Cmd+Y
- export PDFs, individual JPGs, or multiple JPGs in a ZIP

The editing surface is built around an SVG overlay on top of rendered PDF pages. Original page content is preserved in the PDF as much as possible, while user-defined marks are layered on top during export. Edited pages may become rasterized outputs depending on how they were modified.

### B. Document conversion

The app supports conversion between:

- PDF -> DOCX, XLSX, PPTX
- DOCX / XLSX / PPTX / images / TXT / PDF -> PDF

This is handled by server-side conversion utilities and is designed for office documents and image-to-PDF conversion workflows.

### C. PDF unlock

Users can upload a password-protected PDF, provide the PDF password, and download an unlocked copy. This uses a dedicated backend endpoint and a secure worker process.

### D. OCR and searchable PDF creation

Users can create an account, upload an edited PDF, and queue OCR processing. The app stores the uploaded file, processes the document asynchronously, and allows the user to download the searchable PDF once completed.

This flow is account-based and stored server-side with an up-to-10-job limit per account.

---

## 3. Functional feature breakdown

### Editing capabilities

- Text insertion and editing
- Paragraph-level line editing on detected text blocks
- Font, size, color, bold, italic, indentation, and spacing controls
- Image insertion from PNG/JPEG
- Shape creation: rectangles and ellipses
- Signature drawing or image upload
- Drag and move interactions for objects
- Page-level deletion, page rotation, and reordering
- Merge PDFs and append images as pages

### Export and output controls

- export whole document as PDF
- export selected page ranges using range strings like 1, 3-5
- export pages as JPGs
- export images as ZIP packages when multiple JPGs are generated
- export warnings for pages that require rasterization after edits

### Safety and validation

- unsaved-changes warnings on replacement or navigation away
- checks for unsupported, damaged, encrypted, oversized, and interactive-form PDFs
- file size limits
- page count limits
- validation around unsupported image types and PDF protections

---

## 4. Product constraints and MVP boundaries

The app explicitly states these current limitations:

- OCR requires readable English PDF content; it is not a universal OCR engine
- imported text detection is limited to horizontal left-to-right content
- right-to-left, rotated, or complex scanned text is not fully reconstructed for inline editing
- edited pages that include modified source text are exported as rasterized pages and may lose selectable text
- not a redaction tool
- PNG and JPEG input only for image workflows
- no collaborative editing or session persistence beyond the client session
- max 40 MB per uploaded file, max 200 pages per document, and an OCR job timeout of 10 minutes
- certain PDF metadata, bookmarks, attachments, and annotations are not guaranteed to survive export

---

## 5. Tech stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- accessible UI primitives (Shadcn-style design system)
- PDF.js for rendering pages and text extraction
- SVG for editing overlays
- pdf-lib for page copying and export assembly
- Vitest for unit and PDF export testing

### Backend

- Python
- FastAPI
- PostgreSQL
- async background worker processing
- OCRmyPDF + Tesseract for searchable PDF generation
- server-side file storage for uploaded PDFs and generated outputs

### Infrastructure

- Docker Compose for local dev and production orchestration
- Nginx for static hosting and API proxying
- separate worker process for queued OCR jobs
- browser-side workers for rendering/export tasks

---

## 6. Application architecture

The app architecture follows a two-layer model:

1. Browser-first document workflow
    - source PDF bytes are loaded into memory
    - document state is tracked with undo history and page metadata
    - PDF.js renders pages to canvas and extracts text blocks
    - SVG overlays represent user edits, images, shapes, and signa tures
    - export worker reconstructs PDFs and JPG outputs

2. Server-backed services
    - authentication and session management
    - file upload and job persistence
    - OCR job queue and searchable PDF generation
    - conversion and unlock utilities for file processing

This separation is intentional: local editing is fast and offline-friendly, while server features are only used when explicit document processing is required.

---

## 7. Data and session model

### Local browser data

- document source bytes and page metadata
- undo/redo history state
- selected pages and export selection
- marks and overlay objects for each page
- current document name and dirty state

### Server data

- users and password-hashed credentials
- authenticated sessions with expiry windows
- OCR jobs keyed to user accounts
- uploaded input files and generated output files
- root admin access for system-level file and user review

---

## 8. API endpoints

All API routes are served under the /api prefix unless otherwise indicated.

### Authentication and session management

- POST /api/auth/register
    - creates a new user account
    - validates email and password requirements
    - creates a signed-in session cookie

- POST /api/auth/login
    - verifies credentials
    - creates a session cookie

- GET /api/auth/me
    - returns the authenticated user's email and root status

- POST /api/auth/logout
    - clears the session cookie

- GET /api/healthz
    - checks app status and database connectivity

### OCR jobs

- POST /api/jobs
    - accepts a PDF upload for OCR processing
    - validates file type, size, and PDF header
    - stores the uploaded document and creates a queued job

- GET /api/jobs
    - lists all OCR jobs for the authenticated user

- GET /api/jobs/{job_id}/download
    - downloads the generated searchable PDF once the job is completed

- DELETE /api/jobs/{job_id}
    - deletes the stored job and related input/output files

### Conversion

- POST /api/convert
    - converts supported source formats into PDF or Office output
    - supports PDF -> DOCX / XLSX / PPTX and other valid conversion pairs
    - enforces file-size, lock status, and processing limits

### PDF unlock

- POST /api/unlock
    - accepts an encrypted PDF and password payload
    - returns an unlocked PDF output

### Admin endpoints

- GET /api/admin/users
- GET /api/admin/files
- GET /api/admin/files/{job_id}/{kind}
- DELETE /api/admin/files/{job_id}
- DELETE /api/admin/users/{user_id}

These admin routes require root administrator privileges and are used for managing users and OCR job artifacts.

---

## 9. Security model

The backend uses custom request validation for HTTP methods:

- only requests with the x-pdf-studio header and same-site context are accepted for mutating requests
- no cross-origin API access is enabled
- sessions are stored as secure HttpOnly cookies
- passwords are derived using scrypt hashing with per-user salts
- rate limits are enforced on authentication attempts
- access to user-owned job data is restricted by authenticated user ownership

---

## 10. Business positioning

The product sits between a simple PDF viewer and a full document workflow platform:

- it is browser-centered and lightweight
- it emphasizes on-device editing for speed and privacy
- it offers premium OCR and conversion services only when the user explicitly uploads data to the server
- it is positioned as a practical PDF productivity tool rather than a full enterprise document management platform

This makes it useful for freelancers, agencies, small businesses, and internal operations teams that need quick PDF cleanup, document conversion, and searchable output without requiring a complex SaaS platform.

---

## 11. Summary

PDF Studio MVP is a local-first PDF editor with optional server features for OCR, conversion, unlock, and account-based document archival. The app combines browser-side editing capabilities with a Python/FastAPI backend to support higher-value tasks that require server processing, while keeping most editing interactions fast and private to the user.
