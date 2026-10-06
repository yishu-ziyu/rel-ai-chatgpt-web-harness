import { useSyncExternalStore } from 'react';
import { getLanguagePreference, getResolvedLanguage, subscribeUiLanguage } from './i18n.js';

function languageSnapshot() {
  return `${getLanguagePreference()}:${getResolvedLanguage()}`;
}

export function useUiLanguage() {
  useSyncExternalStore(subscribeUiLanguage, languageSnapshot, languageSnapshot);
  return getResolvedLanguage();
}
