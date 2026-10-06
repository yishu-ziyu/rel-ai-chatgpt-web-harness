import { getResolvedLanguage, t } from '../../i18n.js';

function supportPolicyView(policy = {}) {
  const state = String(policy.state || 'unavailable');
  const minimumSupported = policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion}` : t('the supported release');
  const minimumRecommended = policy.minimumRecommendedVersion ? `v${policy.minimumRecommendedVersion}` : minimumSupported;
  if (state === 'current') return { label: t('Supported'), tone: 'ok', description: t('This version is supported.') };
  if (state === 'recommended') return { label: t('Update recommended'), tone: 'warn', description: t`A newer supported version, ${minimumRecommended} or later, is recommended.` };
  if (state === 'deprecated') {
    const deadline = formatPolicyDate(policy.enforceAfter);
    return { label: t('Support ending'), tone: 'warn', description: deadline
      ? t`Support for this version ends on ${deadline}. Update to ${minimumSupported} or later before then.`
      : t`Support for this version is ending. Update to ${minimumSupported} or later to stay supported.` };
  }
  if (state === 'required') return { label: t('Update required'), tone: 'bad', description: t`Update to ${minimumSupported} or later to continue using Rel.AI with ChatGPT.` };
  if (state === 'emergency_blocked') return { label: t('Critical update'), tone: 'bad', description: t('This version must be updated before Rel.AI can work with ChatGPT.') };
  return { label: t('Support check unavailable'), tone: 'warn', description: t('Rel.AI could not check version support right now. You can keep using the app.') };
}

function formatPolicyDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString(getResolvedLanguage(), { year: 'numeric', month: 'long', day: 'numeric' });
}

export { supportPolicyView };
