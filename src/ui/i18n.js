import zhCN from './locales/zh-CN.js';

const LANGUAGE_KEY = 'relai_ui_language';
const listeners = new Set();
let preference = 'system';
let systemLanguage = '';

export function normalizeLanguagePreference(value) {
  return ['system', 'en', 'zh-CN'].includes(value) ? value : 'system';
}

export function getLanguagePreference() {
  return preference;
}

export function getResolvedLanguage() {
  const language = systemLanguage || globalThis.navigator?.language || 'en';
  return preference === 'system' ? (/^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en') : preference;
}

export function subscribeUiLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initUiLanguage(value, locale = '') {
  const previous = `${preference}:${getResolvedLanguage()}`;
  if (locale) systemLanguage = locale;
  if (value === undefined) {
    value = globalThis.document?.documentElement?.dataset.languagePreference;
    if (!value) {
      try { value = globalThis.localStorage?.getItem(LANGUAGE_KEY); } catch { /* Use the system language. */ }
    }
  }
  preference = normalizeLanguagePreference(value);
  const root = globalThis.document?.documentElement;
  if (root) {
    root.lang = getResolvedLanguage();
    root.dataset.languagePreference = preference;
  }
  if (previous !== `${preference}:${getResolvedLanguage()}`) {
    for (const listener of listeners) listener();
  }
  return preference;
}

export async function setLanguagePreference(value) {
  const next = normalizeLanguagePreference(value);
  const bridge = globalThis.window?.relaiDesktop;
  if (globalThis.document?.documentElement?.dataset.surface === 'desktop' && bridge?.setAppPreferences) {
    const result = await bridge.setAppPreferences({ languagePreference: next });
    if (result?.ok === false) throw new Error(result.error || 'Language preference could not be saved.');
  } else {
    try { globalThis.localStorage?.setItem(LANGUAGE_KEY, next); } catch { /* The selection still applies to this page. */ }
  }
  return initUiLanguage(next);
}

// Only application-owned messages passed explicitly to t() are translated.
// Tagged templates preserve runtime values such as project names and paths.
export function t(message, ...values) {
  const template = Array.isArray(message);
  const key = template
    ? message.map((part, index) => part + (index < values.length ? `{${index}}` : '')).join('')
    : String(message);
  const text = getResolvedLanguage() === 'zh-CN' ? (zhCN[key] ?? key) : key;
  return template ? text.replace(/\{(\d+)\}/g, (placeholder, index) => index < values.length ? String(values[index]) : placeholder) : text;
}

export function localizeStaticMarkup(root = globalThis.document) {
  if (!root) return;
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const attribute of ['title', 'placeholder', 'aria-label']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
