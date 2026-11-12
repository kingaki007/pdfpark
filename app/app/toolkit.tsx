import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  Grid2X2,
  Layers3,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  ScanText,
} from 'lucide-react';
import {
  findTool,
  tools,
  toolGroups,
  type ToolDefinition,
} from '@/lib/tool-catalog';
import { useLanguage, locales } from '@/lib/i18n';
import { features } from '@/lib/features';
import './toolkit.css';
const Editor = lazy(() => import('./page'));
const ToolWorkspace = lazy(() => import('../components/tool-workspace'));
const Admin = lazy(() => import('./admin'));
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled. */
  }
}
export default function Toolkit() {
  const { t: translate, locale, setLocale } = useLanguage();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const tool = findTool(path);
  const [theme, setTheme] = useState(() => stored('pdfpark-theme', 'original'));
  const [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('All'),
    [stars, setStars] = useState<string[]>(() => stored('pdfpark-stars', []));
  const [order, setOrder] = useState<string[]>(() => {
    const saved = stored<string[]>('pdfpark-sections', []);
    return [
      ...saved.filter((x) => toolGroups.includes(x)),
      ...toolGroups.filter((x) => !saved.includes(x)),
    ];
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const searchDialog = useRef<HTMLDialogElement>(null);
  const [recent] = useState(() =>
    stored<{ id: string; at: number }[]>('pdfpark-recent', []),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    save('pdfpark-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.title =
      (tool?.title || 'Your complete document workspace') + ' | PDF Park';
    if (tool)
      save(
        'pdfpark-recent',
        [
          { id: tool.id, at: Date.now() },
          ...recent.filter((x) => x.id !== tool.id),
        ].slice(0, 12),
      );
  }, [tool, recent]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMobile(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (searchOpen) {
      searchDialog.current?.showModal();
      searchRef.current?.focus();
    } else searchDialog.current?.close();
  }, [searchOpen]);
  function toggleStar(id: string) {
    const next = stars.includes(id)
      ? stars.filter((x) => x !== id)
      : [...stars, id];
    setStars(next);
    save('pdfpark-stars', next);
  }
  function reorder(group: string, d: number) {
    const next = [...order],
      i = next.indexOf(group);
    if (i + d < 0 || i + d >= next.length) return;
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
    save('pdfpark-sections', next);
  }
  const matching = tools.filter((t) =>
    (t.title + ' ' + t.description + ' ' + t.group)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const home = ['/', '/tools', '/recent', '/starred'].includes(path);
  const pageTitle =
    tool?.title ||
    (path === '/recent'
      ? 'Recent tools'
      : path === '/starred'
        ? 'Starred tools'
        : path === '/about'
          ? 'About PDF Park'
          : path === '/resources'
            ? 'Guides & resources'
            : path === '/admin'
              ? 'Administration'
              : 'Dashboard');
  const card = (t: ToolDefinition, featured = false) => (
    <article
      className={'tk-card' + (featured ? ' tk-featured' : '')}
      key={t.id}
    >
      <a href={'/' + t.id}>
        <span className="tk-tool-icon">
          <FileText size={21} />
        </span>
        <strong>{translate(`tools.${t.id}.title`, t.title)}</strong>
        <p>{translate(`tools.${t.id}.description`, t.description)}</p>
        <span className="tk-card-bottom">
          {t.local ? 'On your device' : 'Document tool'}{' '}
          <ArrowUpRight size={15} />
        </span>
      </a>
      <button
        className={'tk-star ' + (stars.includes(t.id) ? 'selected' : '')}
        aria-label={'Star ' + t.title}
        aria-pressed={stars.includes(t.id)}
        onClick={() => toggleStar(t.id)}
      >
        <Star size={16} />
      </button>
    </article>
  );
  return (
    <div className="tk-app">
      {mobile && (
        <button
          className="tk-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={'tk-sidebar ' + (mobile ? 'is-open' : '')}
        aria-label="PDF tools navigation"
      >
        <a className="tk-brand" href="/">
          <span>
            <FileText size={23} />
          </span>
          <strong>PDF Park</strong>
        </a>
        <button className="tk-search-small" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          Search tools<kbd>Ctrl K</kbd>
        </button>
        <nav className="tk-primary-nav">
          <a aria-current={path === '/' ? 'page' : undefined} href="/">
            <Grid2X2 size={17} />
            Dashboard
          </a>
          <a
            aria-current={path === '/recent' ? 'page' : undefined}
            href="/recent"
          >
            <Clock3 size={17} />
            {translate('nav.recent')}
          </a>
          <a
            aria-current={path === '/starred' ? 'page' : undefined}
            href="/starred"
          >
            <Star size={17} />
            {translate('nav.starred')}
          </a>
          <a
            aria-current={path === '/ocr-pdf' ? 'page' : undefined}
            href="/ocr-pdf"
          >
            <ScanText size={17} />
            {translate('nav.ocr', 'Searchable PDF (OCR)')}
          </a>
          <a
            aria-current={path === '/ocr-library' ? 'page' : undefined}
            href="/ocr-library"
          >
            <FolderOpen size={17} />
            {translate('nav.library', 'OCR Library')}
          </a>
        </nav>
        <div className="tk-sidebar-scroll">
          <span className="tk-nav-label">TOOLS</span>
          {toolGroups.map((group) => (
            <details key={group} open={tool?.group === group || undefined}>
              <summary>
                {translate(`groups.${group}`, group)}
                <span>
                  {tools.filter((t) => t.group === group).length}
                  <ChevronRight size={13} />
                </span>
              </summary>
              {tools
                .filter((t) => t.group === group)
                .map((t) => (
                  <a
                    key={t.id}
                    href={'/' + t.id}
                    aria-current={t.id === tool?.id ? 'page' : undefined}
                  >
                    <FileText size={14} />
                    {t.title}
                  </a>
                ))}
            </details>
          ))}
          <span className="tk-nav-label">RESOURCES</span>
          <a href="/resources">Guides & resources</a>
          <a href="/about">About PDF Park</a>
          <a href="mailto:admin@pdfpark.in">Contact us</a>
        </div>
        <div className="tk-sidebar-bottom">
          <ShieldCheck size={17} />
          <span>Your documents. Your workspace.</span>
        </div>
      </aside>
      <div className="tk-main">
        <header className="tk-topbar">
          <button
            className="tk-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={21} />
          </button>
          <nav aria-label="Breadcrumb">
            <a href="/">Dashboard</a>
            {path !== '/' && (
              <>
                <ChevronRight size={14} />
                <span>{pageTitle}</span>
              </>
            )}
          </nav>
          <label className="tk-theme">
            <span>{translate('theme.label')}</span>
            <select
              aria-label="Color theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="original">{translate('theme.original')}</option>
              <option value="light">{translate('theme.light')}</option>
              <option value="dark">{translate('theme.dark')}</option>
            </select>
          </label>
          {locales.length > 1 && (
            <select
              aria-label="Language"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              {locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </header>
        <main
          id="main-content"
          className={tool?.mode === 'editor' ? 'tk-editor-host' : 'tk-content'}
        >
          {home ? (
            <>
              {path === '/' || path === '/tools' ? (
                <>
                  <section
                    className={
                      'tk-hero' +
                      (features.advertising ? '' : ' tk-hero-no-ads')
                    }
                  >
                    <div>
                      <div className="tk-eyebrow">
                        <span /> A little less paperwork.
                      </div>
                      <h1>
                        {translate('hero.title')}
                        <br />
                        <em>{translate('hero.accent')}</em>
                      </h1>
                      <p>
                        Edit, organize, sign and convert your documents.
                        <br className="tk-desktop-break" /> Everything you need,
                        together in PDF Park.
                      </p>
                      <button
                        className="tk-search-large"
                        onClick={() => setSearchOpen(true)}
                      >
                        <Search size={20} />
                        <span>{translate('hero.search')}</span>
                        <kbd>Ctrl K</kbd>
                      </button>
                      <div className="tk-trust">
                        <span>
                          <ShieldCheck size={15} />
                          No added watermarks
                        </span>
                        <span>
                          <Sparkles size={15} />
                          Made for your everyday
                        </span>
                      </div>
                    </div>
                    {features.advertising && (
                      <aside className="tk-ad" aria-label="Advertising">
                        <span>ADVERTISEMENT</span>
                        <div>
                          <Layers3 size={27} />
                          <strong>A space for good ideas.</strong>
                          <p>Reserved for a future sponsor.</p>
                        </div>
                      </aside>
                    )}
                  </section>
                  {features.advertising && (
                    <section
                      className="tk-ad-strip"
                      aria-label="Featured advertising spaces"
                    >
                      <span>FEATURED SPONSORS</span>
                      <div>
                        {[1, 2, 3, 4].map((n) => (
                          <div key={n}>+ &nbsp; Advertising space</div>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="tk-start">
                    <div className="tk-section-heading">
                      <div>
                        <span className="tk-eyebrow">
                          THE EVERYDAY ESSENTIALS
                        </span>
                        <h2>Start with something simple.</h2>
                      </div>
                      <a href="/edit-pdf-text">
                        Open editor <ArrowUpRight size={16} />
                      </a>
                    </div>
                    <div className="tk-cards">
                      {[
                        'edit-pdf-text',
                        'merge-pdf',
                        'compress-pdf',
                        'pdf-to-word',
                      ].map((id, i) =>
                        card(
                          tools.find((t) => t.id === id)!,
                          i === 0,
                        ),
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <section className="tk-heading">
                  <span className="tk-eyebrow">YOUR WORKSPACE</span>
                  <h1>{pageTitle}</h1>
                  <p>
                    {path === '/recent'
                      ? 'Previously opened tools. Document contents are not stored here.'
                      : 'Keep your favorite tools one click away.'}
                  </p>
                </section>
              )}
              <section className="tk-catalog">
                <div className="tk-section-heading">
                  <div>
                    <h2>
                      {path === '/' ? 'A tool for every task.' : pageTitle}
                    </h2>
                    <p>
                      {tools.length} tools, organized around the way you work.
                    </p>
                  </div>
                  <label className="tk-inline-search">
                    <Search size={16} />
                    <input
                      aria-label="Filter tools"
                      placeholder="Find a tool…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="tk-filters" aria-label="Tool categories">
                  {['All', ...toolGroups].map((g) => (
                    <button
                      key={g}
                      aria-pressed={filter === g}
                      onClick={() => setFilter(g)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {order.map((group) => {
                  const entries = matching.filter(
                    (t) =>
                      t.group === group &&
                      (filter === 'All' || filter === group) &&
                      (path !== '/starred' || stars.includes(t.id)) &&
                      (path !== '/recent' || recent.some((r) => r.id === t.id)),
                  );
                  return (
                    entries.length > 0 && (
                      <section className="tk-category" key={group}>
                        <div className="tk-category-title">
                          <h3>
                            {translate(`groups.${group}`, group)}
                            <span>{entries.length}</span>
                          </h3>
                          <div className="tk-reorder">
                            <button
                              onClick={() => reorder(group, -1)}
                              disabled={order.indexOf(group) === 0}
                              aria-label={'Move ' + group + ' up'}
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => reorder(group, 1)}
                              disabled={
                                order.indexOf(group) === order.length - 1
                              }
                              aria-label={'Move ' + group + ' down'}
                            >
                              <ArrowDown size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="tk-cards">
                          {entries.map((t) => card(t))}
                        </div>
                      </section>
                    )
                  );
                })}
                {((path === '/starred' && !stars.length) ||
                  (path === '/recent' && !recent.length) ||
                  !matching.length) && (
                  <div className="tk-empty">
                    <FolderOpen size={35} />
                    <h3>Nothing here yet</h3>
                    <p>
                      {path === '/starred'
                        ? 'Use the star on any tool to save it here.'
                        : 'Choose a tool or try a different search.'}
                    </p>
                  </div>
                )}
              </section>
              <section className="tk-faq">
                <span className="tk-eyebrow">GOOD TO KNOW</span>
                <h2>A few answers, before you start.</h2>
                {[
                  [
                    'Where are my documents processed?',
                    'The editor and tools marked “On your device” run locally. Other tools send files to PDF Park only when you choose Upload & process. OCR jobs stay in your private library until deleted.',
                  ],
                  [
                    'Are all my existing features still available?',
                    'Yes. The full editor, page management, signatures, undo and redo, document converter, Markdown and PNG exports, OCR accounts and administration are available in this workspace.',
                  ],
                  [
                    'Can I use PDF Park on my phone?',
                    'Yes. The navigation collapses into a menu and tool sections stack for smaller screens. Camera and microphone tools ask for permission when you use them.',
                  ],
                  [
                    'Does PDF Park add a watermark?',
                    'No. Watermarks are only added when you deliberately use the watermark tool.',
                  ],
                  [
                    'Can I customize this workspace?',
                    'Choose PDF Park, Light or Dark in the theme selector. Star your favorite tools and use the arrows beside a category to move it up or down. These preferences stay in this browser.',
                  ],
                ].map(([q, a]) => (
                  <details key={q}>
                    <summary>
                      {q}
                      <span>+</span>
                    </summary>
                    <p>{a}</p>
                  </details>
                ))}
              </section>
            </>
          ) : tool ? (
            <Suspense
              fallback={
                <div className="tk-loading">
                  <Layers3 />
                  <p>Preparing your workspace…</p>
                </div>
              }
            >
              {tool.mode === 'editor' ? (
                <Editor />
              ) : (
                <ToolWorkspace key={tool.id} tool={tool} />
              )}
            </Suspense>
          ) : path === '/admin' ? (
            <Suspense fallback={<p>Loading administration…</p>}>
              <Admin />
            </Suspense>
          ) : ['/about', '/resources'].includes(path) ? (
            <section className="tk-prose">
              <span className="tk-eyebrow">PDF PARK</span>
              <h1>{pageTitle}</h1>
              <p>
                One workspace for documents, images, pages and ideas. Choose a
                tool, select your files, adjust the options and download your
                result.
              </p>
              {toolGroups.map((g) => (
                <section key={g}>
                  <h2>{g}</h2>
                  {tools
                    .filter((t) => t.group === g)
                    .map((t) => (
                      <p key={t.id}>
                        <a href={'/' + t.id}>{t.title}</a> — {t.description}
                      </p>
                    ))}
                </section>
              ))}
            </section>
          ) : (
            <section className="tk-empty">
              <h1>Page not found</h1>
              <p>This tool address does not exist.</p>
              <a className="tk-button" href="/">
                Back to dashboard
              </a>
            </section>
          )}
        </main>
        {tool?.mode !== 'editor' && (
          <footer className="tk-footer">
            <a className="tk-brand" href="/">
              <FileText size={19} />
              <strong>PDF Park</strong>
            </a>
            <span>A little more done. A little less effort.</span>
            <a href="/about">About</a>
            <a href="/resources">Guides</a>
            <a href="mailto:admin@pdfpark.in">Contact us: admin@pdfpark.in</a>
          </footer>
        )}
      </div>
      <dialog
        ref={searchDialog}
        onClose={() => setSearchOpen(false)}
        aria-label="Search tools"
        className="tk-command"
      >
        <div>
          <Search size={21} />
          <input
            ref={searchRef}
            aria-label="Search all tools"
            placeholder="Search tools, formats, tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {matching.map((t) => (
            <a key={t.id} href={'/' + t.id}>
              <FileText size={18} />
              <span>
                <strong>{translate(`tools.${t.id}.title`, t.title)}</strong>
                <small>{t.group}</small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          ))}
          {!matching.length && <p>No tools match your search.</p>}
        </nav>
      </dialog>
    </div>
  );
}
