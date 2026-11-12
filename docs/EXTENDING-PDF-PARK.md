# Extending PDF Park

## Tools and routes

Add a stable slug and metadata in `app/lib/tool-catalog.ts`. The shell builds category
navigation, search, favorites, recent tools and individual routes from this registry.
Keep slugs stable when translating labels. `mode` selects the full editor, existing
converter, bounded server operation, or specialist React workspace.

Server operations live in `backend/toolkit_worker.py`; `backend/toolkit.py` bounds
upload bytes, processing time, concurrent conversions and output size. Do not parse
untrusted PDFs directly in the API event loop. Add functional fixtures for every
new transformation and expose its data handling in the tool UI.

## Languages

`app/lib/i18n.tsx` provides `LanguageProvider`, `useLanguage`, `registerLocale` and
English fallback. Register a locale before rendering the provider. Dictionaries can
be loaded dynamically later. Use stable message keys and interpolation parameters,
not translated strings for logic. A locale declares `ltr` or `rtl`; the provider sets
the document language and direction. Use `Intl` for localized numbers and dates.
Tool titles and descriptions use `tools.<slug>.title` / `.description` keys; category
labels use `groups.<English group name>`. Existing English copy is the fallback.
Legacy editor messages remain English until their message keys are migrated.

## Themes and order

Theme tokens are in `app/app/toolkit.css`. The default is the original blue PDF Park
palette, with independent light and dark palettes. Browser-local preferences store
theme, starred tools and category order. New categories append to saved order.
Advertising slots are outside reorderable categories. Fonts are bundled locally.

## Subscriptions — disabled

`app/lib/subscriptions.ts` explicitly disables both management and payments.
`SubscriptionManagement` renders nothing while disabled. The backend storage and
service in `backend/subscriptions.py` are dormant; no router is mounted. All existing
tools remain available without subscription gating. Do not enable this by merely
changing a front-end flag: agree plans/entitlements and mount authenticated server
routes in a future implementation. `requestPayment` intentionally performs no work,
there is no payment SDK, and no payment provider is contacted.

## Browser AI

AI runs in a disposable worker and downloads public English ONNX models only after
the user starts it. Cancellation terminates the worker. These are separate models
for extractive Q&A, summarization, speech recognition and single-line handwriting.
The first run needs network access and can be memory intensive. Model URLs must be
allowed explicitly in production CSP; no uploaded document is sent to a model host.

## Known fidelity differences

Server tools have a combined 40 MB / 200-page input bound and 80 MB output bound.
Lossy compression, flattening, flipping and color conversion rasterize pages.
PDF-to-Word/Excel retain the original text-oriented PDF Park converters; PowerPoint
uses slide images. HTML and EPUB exports prioritize readable text. Handwriting
recognition accepts single-line images, and generated handwriting uses a cursive
font. Camera scanning currently captures pages without automatic perspective
correction. Pairing uses manual WebRTC offer/answer codes and needs a network that
permits a direct connection. These limitations are not claims of full reference-site
parity; test and extend them before marketing the tools as equivalent.
