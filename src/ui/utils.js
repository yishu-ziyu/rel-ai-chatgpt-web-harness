import { t } from './i18n.js';

// Shared UI helpers for dashboard sections.
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

export function timeAgo(v, now = Date.now()) {
  const ts = typeof v === 'number' && Number.isFinite(v) ? v : Date.parse(String(v || ''));
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor(Math.max(0, now - ts) / 60000);
  if (m < 1) return t('now');
  if (m < 60) return t`${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? t`${h}h ago` : t`${Math.floor(h / 24)}d ago`;
}

export function formatDuration(milliseconds, options = {}) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (options.historical) {
    if (seconds <= 0) return t('0m');
    if (seconds < 60) return t('<1m');
    const minutes = Math.floor(seconds / 60);
    const days = Math.floor(minutes / (24 * 60));
    const remainderAfterDays = minutes % (24 * 60);
    const hours = Math.floor(remainderAfterDays / 60);
    const remainderMinutes = remainderAfterDays % 60;
    if (days) return `${days}${t('d')}${hours ? ` ${hours}${t('h')}` : ''}${remainderMinutes ? ` ${remainderMinutes}${t('m')}` : ''}`;
    if (hours) return `${hours}${t('h')}${remainderMinutes ? ` ${remainderMinutes}${t('m')}` : ''}`;
    return `${minutes}${t('m')}`;
  }
  if (seconds < 60) return `${seconds}${t('s')}`;
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes < 60) {
    return options.live && remainderSeconds ? `${minutes}${t('m')} ${remainderSeconds}${t('s')}` : `${minutes}${t('m')}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  const minuteText = remainderMinutes ? ` ${remainderMinutes}${t('m')}` : '';
  const secondText = options.live && remainderSeconds ? ` ${remainderSeconds}${t('s')}` : '';
  return `${hours}${t('h')}${minuteText}${secondText}`;
}
