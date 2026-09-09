import type { Plugin } from 'vite';

const title = 'PDF Park | Edit, Merge, Convert, Sign & OCR PDFs';
const description = 'Edit and merge PDFs, add signatures, convert Word, Excel, PowerPoint, Markdown and images to PDF, unlock PDFs with a password, and create searchable PDFs with OCR.';
const sections = [
  ['Edit PDF text, images and pages', 'Add text, images, rectangles, ellipses and signatures. Edit detected horizontal text lines, reorder pages, rotate pages and delete pages. Undo and redo changes. Edited original text may be rasterized on export.'],
  ['Merge PDFs and export selected pages', 'Combine multiple PDF files, append images and download all pages or a selected page range. Export PDF pages to JPG; multiple JPG pages download in a ZIP.'],
  ['Word, Excel and PowerPoint to PDF', 'Create PDFs from DOC, DOCX, XLS, XLSX, PPT, PPTX, OpenDocument and RTF files. Office conversion uses LibreOffice on the server; fonts and pagination can differ.'],
  ['PDF to Word, Excel and PowerPoint', 'Extract selectable PDF text into editable DOCX paragraphs or XLSX text rows, with one worksheet per page. Create PPTX slides containing page images. Original Word layouts, spreadsheet tables and editable slide text are not reconstructed.'],
  ['Markdown, text and images to PDF', 'Convert MD, Markdown and TXT files to PDF. Markdown supports headings, lists, tables and code blocks; images become alt-text placeholders. Convert PNG, JPG, WebP, BMP, GIF and TIFF images to PDF pages.'],
  ['Password-protect and unlock PDFs', 'Create a PDF that requires a password to open, or create an unlocked PDF. Use Unlock PDF with the existing password to remove password protection from a copy. This does not recover unknown passwords.'],
  ['OCR: create a searchable PDF', 'Recognize English text in a scanned or edited PDF and download a searchable PDF. Sign in to use the OCR library and return to saved OCR jobs. OCR can misread text.'],
  ['Sign PDFs and add annotations', 'Draw a handwritten signature or upload its image. Add text, images and shapes to pages. Signature images are not cryptographic digital signatures; covering text is not secure redaction.'],
];
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));

export function seoPlugin(): Plugin {
  let origin = '';
  function tags(path: string) {
    return [
      { tag: 'meta', attrs: { name: 'robots', content: origin ? 'index,follow' : 'noindex,nofollow' } },
      { tag: 'meta', attrs: { property: 'og:title', content: title } },
      { tag: 'meta', attrs: { property: 'og:description', content: description } },
      { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
      { tag: 'meta', attrs: { property: 'og:site_name', content: 'PDF Park' } },
      { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
      ...(origin ? [
        { tag: 'link', attrs: { rel: 'canonical', href: origin + path } },
        { tag: 'meta', attrs: { property: 'og:url', content: origin + path } },
      ] : []),
    ];
  }
  function toolsPage() {
      const metadata = tags('/tools.html').map(t => '<' + t.tag + ' ' + Object.entries(t.attrs).map(([k,v]) => k + '="' + escape(v) + '"').join(' ') + '>').join('\n');
      const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF Tools: Conversion, Merge, OCR & Editing | PDF Park</title><meta name="description" content="' + escape(description) + '">' + metadata +
        '<style>body{font:17px/1.65 system-ui,sans-serif;color:#182338;background:#f5f7fb;margin:0}main{max-width:900px;margin:auto;padding:40px 24px}h1{line-height:1.2}h2{font-size:23px}a{color:#185be8}section{background:white;padding:20px 28px;border:1px solid #dae0e8;border-radius:12px;margin:18px 0}footer{margin-top:30px}</style></head><body><main itemscope itemtype="https://schema.org/SoftwareApplication"><a href="/">Open PDF Park editor</a><h1 itemprop="name">PDF Park: PDF editing and conversion tools</h1><p itemprop="description">' + escape(description) + '</p><meta itemprop="applicationCategory" content="UtilitiesApplication"><meta itemprop="operatingSystem" content="Web browser">' +
        sections.map(([heading, text]) => '<section><h2>' + escape(heading) + '</h2><p itemprop="featureList">' + escape(text) + '</p></section>').join('') +
        '<section><h2>How do I use PDF Park?</h2><p>Open the editor and choose Open file to edit a PDF or image, Merge PDFs to combine documents, or Create PDF / Convert for format conversion. Use Export to download your edits.</p><h2>Are my files uploaded?</h2><p>Ordinary editing and exports run in browser memory. OCR, conversion and unlocking upload a copy for server processing. OCR results can be retained in your account library; conversion and unlocking files are temporary.</p><h2>What are the limits?</h2><p>Inputs are limited to 40 MB and documents to 200 pages. Images are limited to 24 megapixels. Interactive PDF forms are not supported by the editor.</p></section><footer><a href="/">Start editing or converting a PDF</a></footer></main></body></html>';
    return html;
  }
  return {
    name: 'pdf-studio-seo',
    configResolved() {
      const value = process.env.SITE_URL?.trim();
      if (value) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
          throw new Error('SITE_URL must be your public HTTPS origin, with no path, query or credentials.');
        }
        origin = url.origin;
      }
    },
    configureServer(server) {
      server.middlewares.use('/tools.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(toolsPage());
      });
    },
    transformIndexHtml() { return tags('/'); },
    generateBundle() {
      const html = toolsPage();
      this.emitFile({type:'asset', fileName:'tools.html', source:html});
      this.emitFile({type:'asset', fileName:'robots.txt', source: origin ? 'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ' + origin + '/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n'});
      if (origin) this.emitFile({type:'asset', fileName:'sitemap.xml', source:'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['/', '/tools.html'].map(path => '<url><loc>' + escape(origin + path) + '</loc></url>').join('') + '</urlset>'});
    },
  };
}


