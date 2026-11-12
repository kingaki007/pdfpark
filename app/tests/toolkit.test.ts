import { describe, it, expect, vi } from 'vitest';
import { findTool, tools, toolGroups } from '../lib/tool-catalog';
import { registerLocale, translate } from '../lib/i18n';
import { requestPayment, subscriptionFeatures } from '../lib/subscriptions';
describe('tool registry', () => {
  it('uses unique stable routes and valid categories', () => {
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
    for (const t of tools) {
      expect(findTool('/' + t.id + '/')).toEqual(t);
      expect(toolGroups).toContain(t.group);
    }
  });
  it('preserves existing editor and export routes', () => {
    expect(findTool('/editor')?.id).toBe('edit-pdf-text');
    expect(findTool('/pdf-to-png')).toBeDefined();
    expect(findTool('/pdf-to-md')?.target).toBe('md');
    expect(findTool('/not-a-tool')).toBeUndefined();
  });
});
describe('language extensions', () => {
  it('falls back to English and interpolates variables', () => {
    registerLocale({
      id: 'test-locale',
      name: 'Test',
      direction: 'rtl',
      messages: { 'nav.dashboard': 'Translated' },
    });
    expect(translate('test-locale', 'nav.dashboard')).toBe('Translated');
    expect(translate('test-locale', 'theme.dark')).toBe('Dark');
    expect(
      translate('test-locale', 'tools.count', undefined, { count: 78 }),
    ).toContain('78 tools');
    expect(translate('unknown', 'new.message', 'Default')).toBe('Default');
  });
});
describe('dormant subscriptions', () => {
  it('keeps management and payment off without network activity', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(subscriptionFeatures.management).toBe(false);
    expect(subscriptionFeatures.payments).toBe(false);
    expect(requestPayment()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
