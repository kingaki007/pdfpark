# PDF Studio MVP

A browser PDF editor with optional server OCR. Local editing and ordinary exports stay in browser memory and need no account. Searchable PDF downloads use an explicit upload, authentication, a PostgreSQL database, and an OCR worker.

## Run with Docker

Start Docker Desktop in Linux-container mode first. Run the following commands in Windows PowerShell.

### Local development with live frontend updates

```powershell
cd T:\PDFEditor
docker compose --profile dev up --build dev
```

Keep the terminal open and visit [http://localhost:5173](http://localhost:5173). This starts the development frontend and its database, API, and OCR worker dependencies. Changes to frontend source files in `app/` appear through hot reload. The container keeps Linux dependencies in a named volume.

After backend code or dependency changes, press Ctrl+C and run the same command again to rebuild. Restart with the same command after frontend package changes as well. Backend code does not hot reload.

### Test locally

1. Open [http://localhost:5173](http://localhost:5173) and import a small PDF. Add text or rotate a page, then export and inspect the downloaded PDF.
2. Click **Convert documents**, select a PDF with selectable text, choose Word, Excel, or PowerPoint, then click **Upload & convert**.
3. Open each download: Word contains editable text, Excel contains text rows in a worksheet per page, and PowerPoint contains a page image per slide. Word/Excel do not reconstruct the original layout or tables; scanned PDFs need OCR first.
4. Select a Word, Excel, or PowerPoint file in **Convert documents** and convert it to PDF. Check the resulting layout and pagination.
5. To include editor changes in a conversion, export the edited PDF first and select that downloaded file in the conversion dialog.

Check service status or inspect errors from a second PowerShell terminal in `T:\PDFEditor`:

```powershell
docker compose --profile dev ps
docker compose logs --tail=100 api
```

### Stop and run development again

Press **Ctrl+C** in the running terminal, then stop the remaining services:

```powershell
docker compose --profile dev down
```

To run again:

```powershell
cd T:\PDFEditor
docker compose --profile dev up --build dev
```

### Run the production build locally

```powershell
cd T:\PDFEditor
docker compose up --build -d web
```

Open [http://localhost:8080](http://localhost:8080). You can use the same test steps above at this address. This runs in the background and does **not** reflect source changes instantly. After code changes, rerun `docker compose up --build -d web`, then refresh the browser.

Stop the production services:

```powershell
docker compose down
```

Run again without code changes:

```powershell
docker compose up -d web
```

The `down` commands preserve saved database data. Adding `-v` deletes the named volumes, including the database. If development and production are both running, `docker compose --profile dev down` stops both.

## Run without Docker (Windows + WSL Ubuntu)

Run the React frontend in Windows PowerShell and PostgreSQL, the API, and the OCR worker in WSL Ubuntu. The OCR worker uses Linux process controls, so run it in WSL rather than native Windows Python.

Prerequisites: Node.js 24 and pnpm 11.19.0 on Windows, plus WSL Ubuntu with Python 3.10 or newer. If WSL is not installed, run `wsl --install -d Ubuntu` in an administrator PowerShell window, restart if prompted, and finish Ubuntu's first-run setup.

### 1. Install backend dependencies and create the database (once)

In a WSL Ubuntu terminal:

```bash
sudo apt update
sudo apt install -y postgresql python3-venv ocrmypdf tesseract-ocr-eng
sudo service postgresql start

sudo -u postgres psql -c "CREATE USER pdfstudio WITH PASSWORD 'local-development-only' CREATEDB;"
sudo -u postgres createdb -O pdfstudio pdfstudio

cd /mnt/t/PDFEditor/backend
python3 -m venv ~/.venvs/pdfstudio
source ~/.venvs/pdfstudio/bin/activate
pip install -r requirements.txt
```

Run the database creation commands only once. The `CREATEDB` permission supports integration tests that create a temporary database. The password above is for local development; use your own credentials outside this setup.

If `/mnt/t` is unavailable and T: is a local Windows drive, mount it first:

```bash
sudo mkdir -p /mnt/t
sudo mount -t drvfs T: /mnt/t
```

### 2. Start the API

In the same WSL terminal:

```bash
cd /mnt/t/PDFEditor/backend
source ~/.venvs/pdfstudio/bin/activate
export DATABASE_URL='postgresql://pdfstudio:local-development-only@localhost:5432/pdfstudio'
export COOKIE_SECURE=false
uvicorn main:app --host 0.0.0.0 --port 8000
```

Leave this terminal running. The API creates its database tables on startup. `COOKIE_SECURE=false` permits sign-in cookies over local HTTP; use `true` with HTTPS when deploying.

### 3. Start the OCR worker

Open a second WSL Ubuntu terminal:

```bash
cd /mnt/t/PDFEditor/backend
source ~/.venvs/pdfstudio/bin/activate
export DATABASE_URL='postgresql://pdfstudio:local-development-only@localhost:5432/pdfstudio'
python worker.py
```

Leave this terminal running too. It processes queued OCR uploads in the background.

### 4. Start the frontend

In Windows PowerShell:

```powershell
cd T:\PDFEditor\app
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Vite forwards `/api` requests to `http://localhost:8000`. Use `pnpm dev` for this full-stack workflow; the static `pnpm preview` server has no API proxy configured.

For local editing alone, only the frontend is needed. Authentication and OCR require PostgreSQL, the API, and the OCR worker.

### 5. Test the complete app

1. Open a PDF or image, add text, rotate a page, and try undo/redo.
2. Use **Export** to download an ordinary PDF or JPG and check that your local edits are present.
3. Click **Searchable PDF**, then **Create an account**. Enter an email and a password of 10–128 characters.
4. Choose a page range if needed and click **Upload edited PDF & start OCR**. This explicitly uploads an edited copy to the server.
5. Wait for the job to show **completed**, then choose **Download searchable PDF**.
6. Open the download in a PDF viewer and search for a visible English phrase, including text you added. OCR rasterizes pages and can misread text.
7. Sign out and back in to verify that the job remains in your library. Delete it when no longer needed.

The OCR library stores up to 10 jobs per account. Uploads are limited to 40 MB and 200 pages; processing has a 10-minute limit. Saving an OCR result does not save the editable browser session or its undo history.

### Checks and troubleshooting

Check the API directly at [http://localhost:8000/api/healthz](http://localhost:8000/api/healthz) and through Vite at [http://localhost:5173/api/healthz](http://localhost:5173/api/healthz). Both should return `{"status":"ok"}`.

Run frontend checks in Windows PowerShell:

```powershell
cd T:\PDFEditor\app
pnpm lint
pnpm test
pnpm build
```

Run backend integration tests in WSL with the virtual environment active and `DATABASE_URL` set as above:

```bash
cd /mnt/t/PDFEditor/backend
python -m pytest -q -p no:cacheprovider
```

Tests create and remove an isolated temporary database and include a real OCR download check.

- **Database connection refused:** run `sudo service postgresql start` in WSL.
- **OCR server unavailable:** check the API terminal and both health URLs.
- **Windows cannot reach the WSL API:** run `hostname -I` in WSL, then set `$env:API_PROXY_TARGET = "http://<WSL-IP>:8000"` in the frontend PowerShell terminal and restart `pnpm dev`.
- **Job stays queued:** ensure the second WSL terminal is running `python worker.py` with the same `DATABASE_URL` as the API.
- **Job fails:** try a smaller, readable English PDF and check `ocrmypdf --version` and `tesseract --list-langs` in WSL; the language list must include `eng`.
- **Port already in use:** stop the other process using 5173 or 8000, including a Docker development service if one is running.

Stop the frontend, API, and worker with Ctrl+C in each terminal. PostgreSQL and saved jobs persist; optionally stop PostgreSQL with `sudo service postgresql stop`. For later runs, start PostgreSQL and repeat steps 2–4.

## Implemented workflow

- Open PDFs, navigate pages, zoom, and view lazy-rendered thumbnails.
- Edit lines in added text boxes and imported PDF paragraphs, with per-line font, size, color, bold, italic, indentation, and spacing. Insert above/below or remove a line with undo/redo.
- Add text, PNG/JPEG images, rectangles, and ellipses. Move objects by dragging; resize with the corner handle or property inputs. Edit text and color in the properties panel.
- Draw a handwritten signature or import a signature image.
- Reorder using thumbnail arrows, rotate pages, and delete pages (at least one page is retained).
- Merge PDFs and append images as PDF pages.
- Select export pages using checkboxes or a range such as `1, 3-5`.
- Export PDF, one JPG, or multiple JPGs in a ZIP.
- Undo/redo up to 50 changes. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y are supported. Delete removes a selected object.
- Warn about unsaved changes before replacing or leaving a document.
- Show errors for unsupported, damaged, encrypted, oversized, and interactive-form PDFs.

## Stack and architecture

React 19 + TypeScript + Vite, Tailwind CSS and the starter's accessible Base UI/Shadcn primitives. PDF.js renders pages in its own worker. pdf-lib copies original pages and assembles exports in a separate browser worker. SVG provides the editing surface. fflate packages JPGs. Vitest covers model operations and PDF assembly.

The generated Sites starter dependencies remain available, but this application uses a static Vite entry rather than server rendering. Nginx serves compiled static files and proxies API requests. Browser rendering/export workers remain bundled assets. FastAPI handles accounts and account-owned OCR jobs, PostgreSQL persists sessions and PDFs, and a separate OCRmyPDF/Tesseract worker creates searchable downloads.

```
Browser file input
  -> immutable source bytes + stable page IDs
  -> document state / bounded undo history
  -> PDF.js worker -> canvas + SVG objects
  -> rasterized transparent object layer
  -> PDF export worker -> downloaded PDF
  -> PDF.js rendering -> JPG / ZIP download
```

Coordinates are stored in the source page's PDF.js viewport at scale 1. Inverse transforms handle pointer editing after rotation. Export maps overlays back through the original PDF rotation and crop origin, then applies user rotation. Original page content remains vector content; newly added objects are flattened raster overlays (up to 2x, maximum 4096 pixels per side).

## Project layout

```
app/app/page.tsx                 Editor application
app/components/pdf-canvas.tsx    Page rendering and overlay display
app/components/signature-pad.tsx Signature capture
app/lib/editor-model.ts         Types, history, geometry, ranges
app/lib/pdf-engine.ts           Import, images, overlay rendering, downloads
app/lib/pdf-export.ts           PDF copying and overlay placement
app/lib/pdf-export.worker.ts    Background export assembly
app/tests/                      Model and PDF integration tests
Dockerfile                      Development, build, production stages
docker/nginx.conf               Static hosting and health endpoint
compose.yaml                    Production and optional dev services
.github/workflows/              CI verification and GHCR release
```

## CI/CD

Pull requests and pushes to main run lint, tests, type checking, a production build, and a Docker HTTP smoke test. Version tags (`v*`) build and publish the production image to GitHub Container Registry. Connect this folder to a GitHub repository to activate the workflows. No repository has been created remotely.

The release workflow publishes an image; it does not deploy to a server. Configure your hosting platform to pull a tested image tag/digest. Use HTTPS for non-local hosting (browser workers and crypto APIs require a secure context), and retain the previous image digest for rollback. Production hosting credentials and automatic rollout are intentionally unconfigured because no target server was supplied.

## MVP boundaries

- Adds and edits formatted text lines. **Edit lines** detects horizontal left-to-right text in imported PDFs. Select a highlighted paragraph, then insert, remove, or edit lines in the properties panel. Scanned pages need OCR first; rotated, vertical, and right-to-left text are not detected for editing.
- New lines inherit font, size, color, bold/italic style, spacing, indentation, and leading whitespace. Mixed styles in untouched text are retained. Imported fonts are matched to Arial, Times New Roman, or Courier New; custom fonts and backgrounds may need manual adjustment. Source colors are sampled from the rendered page. Text over images or patterned backgrounds is not reconstructed exactly.
- Lines reflow inside the selected paragraph; surrounding objects do not automatically move or flow to another page. Edits that newly overlap known text/objects or exceed the page are rejected.
- Pages with edited original text are exported as fresh raster pages (up to 2x, maximum 4096 pixels per side), so removed source text is not retained underneath. These pages lose selectable text, links, and vector detail. Untouched pages still copy original content. Optional server OCR can make an edited copy searchable.
- Not a redaction tool. Covering content does not delete the underlying text.
- Signature images are not cryptographic signatures. Interactive PDF forms, including signature fields, are rejected. Existing signature validity is not preserved by editing.
- PNG and JPEG image input only. English OCR and saved OCR downloads are supported; Basic Office conversion is supported as described below; collaboration and editable-session saving are not.
- Work stays in memory. Refreshing loses the editable session; export before leaving. A downloaded file cannot restore the editor's object history.
- Maximum 40 MB per input file, 200 pages per document, and 24 megapixels per input image. Large merges still depend on available browser memory.
- Bookmarks, document-level metadata, tags, embedded attachments and complex annotations are not guaranteed to survive page copying. Check important outputs in your normal PDF viewer.
- Desktop browsers are the primary target. Narrow screens expose the properties panel below the canvas.

No analytics or document-content logging is configured. Rendering support files are served locally from `public/pdf-assets`, copied during development/build.

## Document conversion

Choose **Convert documents** in the header, select a file, then **Upload & convert**. This explicitly uploads the selected file and downloads the result. Export editor changes first and select that exported PDF to include them.

- PDF → DOCX: selectable text as editable paragraphs, with page breaks. Layout and images are not reconstructed.
- PDF → XLSX: one worksheet per page and one text line per row; tables and formulas are not reconstructed. Text beginning with `=` stays text.
- PDF → PPTX: one rendered page image per slide; slide text is not editable.
- DOC/DOCX/ODT/RTF, XLS/XLSX/ODS, PPT/PPTX/ODP → PDF: LibreOffice rendering. Check font substitution and pagination.

Scanned PDFs require the existing OCR workflow before text extraction. Conversions use temporary files, deleted after the response is prepared, and do not enter the OCR library. No sign-in is required. The API allows one conversion at a time per process, a 40 MB input, 200 PDF pages, an 80 MB output, and 45 seconds of processing. Run the API in Linux/WSL or Docker; subprocess cleanup uses Linux process groups. The service container provides the memory boundary; for public hosting, use a dedicated conversion service with network isolation and request rate limits.

Docker builds install the conversion engines automatically: `docker compose up --build -d`. For WSL, activate the backend virtual environment, run `pip install -r requirements.txt`, and install `sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu-core`. Restart the API. Run converter checks with `python -m pytest test_conversion.py -q` from `backend/`.

## Unlock password-protected PDFs

Choose **Unlock PDF** in the header, select a locked PDF, enter its password, then click **Unlock & export**. The app downloads a copy with password protection removed. Either the document-open password or owner password is accepted. Incorrect passwords show an error and can be retried. PDFs that open without a password can use a blank password.

This explicitly sends the PDF and password to the backend; no sign-in is required. The password is passed to an isolated process through stdin, and temporary PDF files are deleted after processing. Limits are 40 MB input, 200 pages, 80 MB output, and 45 seconds. Page content is preserved without rasterization. Rewriting a PDF does not preserve digital-signature validity.

Use **Open file** on the downloaded copy to edit it and export changes normally. The editor's existing form restrictions still apply. Restart/rebuild the API and frontend to enable the feature; it uses the existing PyMuPDF dependency. Run backend checks with python -m pytest test_unlock.py -q.

## View and copy stored document files

These steps apply after rebuilding with server filesystem storage enabled. PostgreSQL keeps document names, owners, statuses, and file references; the PDFs themselves are in the shared server document folder.

### View your documents in the app

1. Open [the development app](http://localhost:5173) or [the production app](http://localhost:8080).
2. Click **Searchable PDF**, sign in, and find your document in the library.
3. For a completed job, click **Download searchable PDF** and open the downloaded file.

Administrators can also use `/admin` to inspect retained documents and download available files; see **Root administration** above.

### Enable server file storage after an upgrade

If your running containers still use the older database storage implementation, stop them before rebuilding so the old worker does not run during migration:

```powershell
cd T:\PDFEditor
docker compose --profile dev down
docker compose up --build -d web
```

For local development, replace the last command with:

```powershell
docker compose --profile dev up --build dev
```

Startup migrates existing database PDFs into server files. This storage migration has not yet been verified by regression tests. Back up existing data before upgrading. Do not add `-v` to the shutdown command.

### List files directly on the server

With the API container running, open PowerShell and run:

```powershell
cd T:\PDFEditor
docker compose exec api ls -lR /data/documents
```

The API and worker share the Docker volume `pdf-studio_documents`, mounted at `/data/documents`. The default volume name assumes the project's configured Compose name has not been overridden. File paths look like:

```text
/data/documents/<job-id>/input.pdf
/data/documents/<job-id>/output.pdf
```

`input.pdf` is the uploaded OCR input and is removed after processing finishes or fails. `output.pdf` is the saved searchable PDF and remains until its job is deleted. Folder names are job IDs, not original document names. The app library or admin panel shows document names and owners.

### Copy stored files to Windows

To copy the currently retained files from the server into a local folder:

```powershell
cd T:\PDFEditor
New-Item -ItemType Directory -Force .\downloaded-documents
docker compose cp api:/data/documents/. .\downloaded-documents
```

Open `T:\PDFEditor\downloaded-documents` in File Explorer, open a job folder, then open its PDF. Repeating the copy can overwrite files with matching paths. This is a copy for inspection, not a consistent backup while uploads and OCR jobs are running. Server administrators with Docker access can copy files belonging to all users.

### Which files will appear?

- OCR uploads appear while waiting or processing; completed searchable PDFs remain in server storage.
- Conversion and unlock files are temporary and will not remain in this folder or the library.
- Files opened only in the browser editor are not uploaded to the server.
- Without Docker, storage defaults to `.data/documents/` under the project root. If `DOCUMENT_STORAGE_DIR` is configured, inspect that directory instead; both API and worker must use the same directory.

If `/data/documents` is missing, check that you rebuilt the API and worker with the storage change. If it is empty, upload a PDF through **Searchable PDF** and wait for OCR to complete. Inspect errors with:

```powershell
docker compose logs --tail=100 api worker
```

`docker compose down` preserves both database and document volumes. `docker compose down -v` deletes them. Back up the database and document volume together to preserve both library records and their files.

## Markdown to PDF

1. Open **Create PDF / Convert** and select a `.md` or `.markdown` file.
2. Choose **Unlocked** or **Locked** PDF protection; enter and confirm a password for locked output.
3. Click **Upload & create PDF**, then open the download.

Markdown is formatted with headings, paragraphs, emphasis, ordered/unordered lists, blockquotes, tables, links and fenced code blocks on A4 pages. Input must be UTF-8 or UTF-16. Raw HTML is displayed as text. Images are replaced with alt-text placeholders; the converter does not fetch images or resolve local image paths. This is document rendering, not a full GitHub or browser layout engine.

The file is uploaded for temporary server processing and is not retained in the library. Existing 40 MB input, 200-page output and conversion timeout limits apply. Rebuild the API after upgrading to install the Markdown parser: `docker compose up --build -d web`, or `docker compose --profile dev up --build dev` for development.

Run Markdown checks from `backend/` with `python -m pytest test_markdown_pdf.py -q`.

## Unique browser tracking

Opening the editor sends one POST to /api/visit. The server sets a random first-party pdf_visitor cookie (HttpOnly, SameSite=Strict, one-year lifetime renewed on each visit; Secure when COOKIE_SECURE=true). PostgreSQL's visitors table stores only its SHA-256 hash, first_seen, last_seen and visits. Each editor page load/reload increments visits; opening /admin does not. The tracker does not store location, raw IP addresses, user agents, fingerprints, account IDs, or document details. Existing web-server access logs are separate from this tracker.

Root administrators can see unique browsers, total editor visits, and browsers active within 24 hours on /admin. Click Refresh to update the numbers. Clearing cookies, cookie expiry, private browsing, or another browser/device creates a new visitor. Blocked cookies can cause repeated loads to count as new browsers. Counts are estimates, not verified people or bot-filtered analytics. Aggregate browser records currently have no automatic expiry.

The saved document library is unchanged. Rebuild with docker compose up --build -d web to enable tracking and create the table on API startup.

Manual check: open the editor, refresh twice, then check /admin. There should be one new browser and three visits. Clear the pdf_visitor cookie and reload to create another browser.

## Search engine optimization and public deployment

The site includes descriptive titles, descriptions, Open Graph/social metadata, and a crawlable /tools.html page covering PDF editing, merging, selected-page export, signatures, JPG/image conversion, Word/Excel/PowerPoint conversion, Markdown, password protection/unlocking and OCR. The page describes limitations rather than promising unsupported conversions. The editor footer links to it. Structured SoftwareApplication microdata describes the visible feature content. Admin and API responses receive noindex headers in production.

Until a public domain is configured, HTML includes noindex and robots.txt disallows crawling. Localhost cannot appear as your public website in search results. No placeholder canonical domain is emitted.

When ready to deploy, set SITE_URL to your actual public HTTPS origin (no path), then rebuild. In PowerShell:

```powershell
$env:SITE_URL = 'https://YOUR-ACTUAL-DOMAIN'
docker compose up --build -d web
```

Replace the example value with your real domain. You can also set SITE_URL in the Compose .env file. For a direct frontend build, set the same environment variable before pnpm build. Changing SITE_URL requires rebuilding the frontend image.

With SITE_URL set, the build emits canonical URLs, social URLs, a sitemap.xml listing the homepage and tools page, and robots.txt referencing the sitemap. Deploy behind HTTPS, ensure those URLs are publicly accessible, verify your domain in Google Search Console/Bing Webmaster Tools, and submit the sitemap. Check rendered pages and indexing reports after deployment. Search engines decide indexing and rankings; metadata does not guarantee placement for every feature keyword.

Reference: https://developers.google.com/search/docs/fundamentals/get-started-developers
