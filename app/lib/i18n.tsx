import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
// Stable keys (including tools.<slug>.title/description) keep URLs language-independent.
// New locales can provide partial dictionaries: missing messages fall back to English.
export type Messages = Record<string, string>;
export type Locale = {
  id: string;
  name: string;
  direction: 'ltr' | 'rtl';
  messages: Messages;
};
const english: Messages = {
  'nav.dashboard': 'Dashboard',
  'nav.recent': 'Recent tools',
  'nav.starred': 'Starred',
  'nav.search': 'Search tools',
  'nav.resources': 'Guides & resources',
  'nav.about': 'About PDF Park',
  'nav.admin': 'Administration',
  'theme.label': 'Theme',
  'theme.original': 'PDF Park',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'hero.eyebrow': 'A little less paperwork.',
  'hero.title': 'Every document tool.',
  'hero.accent': 'One peaceful place.',
  'hero.description':
    'Edit, organize, sign and convert your documents. Everything you need, together in PDF Park.',
  'hero.search': 'What would you like to do?',
  'tools.all': 'All',
  'tools.count': '{count} tools, organized around the way you work.',
  'actions.download': 'Download',
  'actions.process': 'Process files',
  'actions.upload': 'Upload & process',
  'actions.processing': 'Processing…',
  'files.choose': 'Choose a file to get started',
  'files.chooseMany': 'Choose files to get started',
  'files.drop': 'Click to browse or drag and drop',
  'subscriptions.title': 'Subscription management',
  'subscriptions.disabled': 'Subscriptions are not available yet.',
  'payment.label': 'Payment unavailable',
};
export const locales: Locale[] = [
  { id: 'en', name: 'English', direction: 'ltr', messages: english },
];
export function registerLocale(locale: Locale) {
  if (locales.some((l) => l.id === locale.id))
    throw new Error('Locale already registered');
  locales.push(locale);
}
export function translate(
  locale: string,
  key: string,
  fallback = key,
  variables: Record<string, string | number> = {},
) {
  const template =
    locales.find((l) => l.id === locale)?.messages[key] ??
    english[key] ??
    fallback;
  return template.replace(/\{(\w+)\}/g, (full, k) =>
    k in variables ? String(variables[k]) : full,
  );
}
type Context = {
  locale: string;
  setLocale: (id: string) => void;
  t: (
    key: string,
    fallback?: string,
    variables?: Record<string, string | number>,
  ) => string;
};
const LanguageContext = createContext<Context>({
  locale: 'en',
  setLocale: () => {},
  t: (key, fallback, variables) => translate('en', key, fallback, variables),
});
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(() => {
    try {
      const id = localStorage.getItem('pdfpark-locale');
      return locales.some((l) => l.id === id) ? id! : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    const config = locales.find((l) => l.id === locale) || locales[0];
    document.documentElement.lang = config.id;
    document.documentElement.dir = config.direction;
    try {
      localStorage.setItem('pdfpark-locale', config.id);
    } catch {}
  }, [locale]);
  return (
    <LanguageContext.Provider
      value={{
        locale,
        setLocale: (id) =>
          setLocale(locales.some((l) => l.id === id) ? id : 'en'),
        t: (key, fallback, variables) =>
          translate(locale, key, fallback, variables),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
export const useLanguage = () => useContext(LanguageContext);
