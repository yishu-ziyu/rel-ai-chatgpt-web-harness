import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANALYTICS_USE_CASES,
  analyticsTaskIntentLabel,
  analyticsUseCaseLabel,
  analyticsUseCaseShortLabel,
  isPrimaryAnalyticsUseCase
} from '../../../contracts/analyticsTaxonomy.js';
import { Icon } from '../../components/icons.js';
import { getResolvedLanguage, t } from '../../i18n.js';
import { useUiLanguage } from '../../i18n-react.js';
import { getRouteParams, getWorkspaceFilter, replaceRouteParams, routeHref } from '../../router.js';
import { ANALYTICS_RANGES, analyticsBounds, workspaceOptions } from './range-model.js';
import { loadAnalyticsData } from './data.js';
import { analyticsPrivacyCopy, customDateDefaults, rangeButtonLabel } from './index.js';
import { analyticsMetrics, failureCategoryLabel, formatChartValue, integer, pointMetric, timelineModel } from './render.js';

const h = React.createElement;
const SparkChart = lazy(() => import('../../components/charts.js').then(module => ({ default: module.SparkChart })));
const AnalyticsTimelineChart = lazy(() => import('../../components/charts.js').then(module => ({ default: module.AnalyticsTimelineChart })));
const AnalyticsBubbleMatrixChart = lazy(() => import('../../components/charts.js').then(module => ({ default: module.AnalyticsBubbleMatrixChart })));
const USAGE_STORE_KEYS = Object.freeze(['live']);
const CHART_METRICS = Object.freeze([
  ['toolCalls', 'Actions', 'activity'],
  ['recoverableFailures', 'Retryable problems', 'refresh'],
  ['operationSuccessRate', 'Successful actions', 'success'],
  ['averageDuration', 'Average time', 'timer']
]);
const METRIC_ICONS = Object.freeze({
  toolCalls: 'activity',
  recoverableFailures: 'refresh',
  operationSuccessRate: 'success',
  averageDuration: 'timer',
  requestDeliveryRate: 'connection'
});

export function createUsageRoute(useDashboardSlices) {
  return function UsageRoute() {
    useUiLanguage();
    const { live } = useDashboardSlices(USAGE_STORE_KEYS);
    const params = useMemo(() => getRouteParams(), []);
    const requestedRange = params.get('range');
    const defaults = useMemo(() => customDateDefaults(), []);
    const [range, setRange] = useState(() => ANALYTICS_RANGES.some(([key]) => key === requestedRange) ? requestedRange : '24h');
    const [start, setStart] = useState(params.get('start') || defaults.start);
    const [end, setEnd] = useState(params.get('end') || defaults.end);
    const [workspace, setWorkspace] = useState(() => getWorkspaceFilter());
    const [loadState, setLoadState] = useState({ status: 'loading', message: '' });
    const [analytics, setAnalytics] = useState(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const [status, setStatus] = useState('Loading analytics…');
    const initialLoad = useRef(true);
    const loadingRef = useRef(false);
    const pendingLiveRefreshRef = useRef(false);
    const analyticsRef = useRef(null);
    const taskRevision = Number(live?.revisions?.task || 0);

    const load = useCallback(async ({ silent = false } = {}) => {
      if (loadingRef.current) {
        if (silent) pendingLiveRefreshRef.current = true;
        return;
      }
      loadingRef.current = true;
      let bounds;
      try {
        bounds = analyticsBounds(range, { customStart: start, customEnd: end });
      } catch (error) {
        loadingRef.current = false;
        setLoadState({ status: 'error', message: messageOf(error) });
        setStatus('Analytics could not be loaded.');
        return;
      }
      if (!silent) {
        setLoadState({ status: 'loading', message: '' });
        setStatus('Loading analytics…');
      }
      try {
        const result = await loadAnalyticsData({ desktop: window.relaiDesktop, bounds, workspace });
        analyticsRef.current = result;
        setAnalytics(result);
        setLoadState({ status: 'ready', message: '' });
        setStatus(t`Analytics updated for ${t(bounds.label)}.`);
      } catch (error) {
        if (!silent || !analyticsRef.current) setLoadState({ status: 'error', message: messageOf(error) });
        setStatus(silent ? 'Analytics could not be refreshed.' : 'Analytics could not be loaded.');
      } finally {
        loadingRef.current = false;
        if (pendingLiveRefreshRef.current) {
          pendingLiveRefreshRef.current = false;
          queueMicrotask(() => { void load({ silent: true }); });
        }
      }
    }, [range, start, end, workspace]);

    useEffect(() => {
      void load();
    }, [load, refreshToken]);

    useEffect(() => {
      if (initialLoad.current) {
        initialLoad.current = false;
        return undefined;
      }
      const timer = window.setTimeout(() => { void load({ silent: true }); }, 180);
      return () => window.clearTimeout(timer);
    }, [taskRevision]);

    useEffect(() => {
      const syncFromRoute = () => {
        const next = getRouteParams();
        const nextRange = next.get('range');
        setRange(ANALYTICS_RANGES.some(([key]) => key === nextRange) ? nextRange : '24h');
        setStart(next.get('start') || defaults.start);
        setEnd(next.get('end') || defaults.end);
        setWorkspace(getWorkspaceFilter());
      };
      window.addEventListener('hashchange', syncFromRoute);
      return () => window.removeEventListener('hashchange', syncFromRoute);
    }, [defaults]);

    const changeWorkspace = value => {
      setWorkspace(value);
      replaceRouteParams({ workspace: value || null });
    };
    const changeRange = value => {
      setRange(value);
      const custom = value === 'custom';
      replaceRouteParams({ range: value === '24h' ? null : value, start: custom ? start : null, end: custom ? end : null });
    };
    const changeDate = (key, value) => {
      if (key === 'start') setStart(value); else setEnd(value);
      if (range === 'custom') replaceRouteParams({ [key]: value });
    };
    const options = analytics ? workspaceOptions(analytics.models) : [];
    const selectedWorkspace = options.some(option => option.workspace === workspace) ? workspace : '';

    return h('div', { className: 'settings-content system-content', 'data-usage-react': 'true' },
      h('section', { className: 'usage-page', 'data-usage-page': true },
        h(AnalyticsToolbar, {
          end,
          loading: loadState.status === 'loading',
          onDateChange: changeDate,
          onRangeChange: changeRange,
          onRefresh: () => setRefreshToken(value => value + 1),
          onWorkspaceChange: changeWorkspace,
          options,
          range,
          selectedWorkspace,
          start
        }),
        h(PrivacyCard, { privacy: analytics?.privacy }),
        h('div', { className: 'sr-only', 'data-usage-status': true, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, t(status)),
        h('div', { className: 'usage-content', 'data-usage-content': true, 'aria-busy': loadState.status === 'loading' ? 'true' : undefined },
          loadState.status === 'loading' && !analytics
            ? h('div', { className: 'usage-loading' }, t('Loading analytics…'))
            : loadState.status === 'error'
              ? h('section', { className: 'usage-unavailable empty-state', 'data-usage-unavailable': true },
                  h('strong', null, t('Analytics unavailable')), h('p', null, loadState.message || t('Analytics could not be loaded.')),
                  h('button', { type: 'button', className: 'secondary', 'data-usage-retry': true, onClick: () => setRefreshToken(value => value + 1) }, t('Retry'))
                )
              : analytics ? h(UsageContent, { bounds: analytics.bounds, current: analytics.current, previous: analytics.previous }) : null
        )
      )
    );
  };
}

function AnalyticsToolbar({ end, loading, onDateChange, onRangeChange, onRefresh, onWorkspaceChange, options, range, selectedWorkspace, start }) {
  return h('div', { className: 'feature-toolbar usage-toolbar' },
    h('div', { className: 'usage-toolbar-heading' },
      h('div', { className: 'usage-title-row' }, h(Icon, { name: 'usage', size: 20 }), h('h2', null, t('Analytics'))),
      h('p', null, t('Analytics are stored on this computer. Rel.AI records aggregate action categories and work-type labels, not prompts, file paths, command output, or action results.'))
    ),
    h('div', { className: 'usage-toolbar-controls' },
      h('label', { className: 'usage-workspace-control' },
        h('span', null, t('Project')),
        h('select', { 'data-usage-workspace': true, value: selectedWorkspace, onChange: event => onWorkspaceChange(event.target.value) },
          h('option', { value: '' }, t('All projects')),
          options.map(option => h('option', { key: option.workspace, value: option.workspace }, option.workspace))
        )
      ),
      h('div', { className: 'usage-range-control' },
        h('span', null, t('Range')),
        h('select', { 'data-usage-range': true, hidden: true, value: range, onChange: event => onRangeChange(event.target.value) },
          ANALYTICS_RANGES.map(([key, label]) => h('option', { key, value: key }, t(label)))
        ),
        h('div', { className: 'usage-range-switch', role: 'group', 'aria-label': t('Analytics range') },
          ANALYTICS_RANGES.map(([key, label]) => h('button', {
            key,
            type: 'button',
            'data-usage-range-option': key,
            'aria-label': t(label),
            title: t(label),
            'aria-pressed': range === key ? 'true' : 'false',
            onClick: () => onRangeChange(key)
          }, t(rangeButtonLabel(key, label))))
        )
      ),
      h('div', { className: 'usage-custom-range', 'data-usage-custom-range': true, hidden: range !== 'custom' },
        h('label', { htmlFor: 'usage-start' }, h('span', null, t('From')), h('input', { id: 'usage-start', type: 'date', 'data-usage-start': true, value: start, onChange: event => onDateChange('start', event.target.value) })),
        h('label', { htmlFor: 'usage-end' }, h('span', null, t('To')), h('input', { id: 'usage-end', type: 'date', 'data-usage-end': true, value: end, onChange: event => onDateChange('end', event.target.value) }))
      ),
      h('button', {
        type: 'button',
        className: 'secondary usage-toolbar-refresh',
        'data-usage-refresh': true,
        disabled: loading,
        onClick: onRefresh
      }, h(Icon, { name: 'refresh', className: loading ? 'is-spinning' : '' }), h('span', null, t(loading ? 'Loading…' : 'Refresh')))
    )
  );
}

function PrivacyCard({ privacy }) {
  if (!privacy) return h('div', { 'data-usage-privacy': true });
  const copy = analyticsPrivacyCopy(privacy);
  return h('div', { 'data-usage-privacy': true },
    h('section', { className: 'card usage-privacy-card', 'aria-label': t('Analytics privacy') },
      h('div', { className: 'card-body usage-privacy-body' },
        h('div', { className: 'usage-privacy-copy' },
          h('strong', { className: 'usage-privacy-title' }, h(Icon, { name: 'reliability', size: 17 }), h('span', null, t('Data & privacy'))),
          h('span', null, copy.retention),
          h('span', null, copy.telemetry)
        )
      )
    )
  );
}

function UsageContent({ bounds, current, previous }) {
  const [chartKey, setChartKey] = useState('toolCalls');
  const chart = CHART_METRICS.find(([key]) => key === chartKey) || CHART_METRICS[0];
  const fallback = current.usedMonthlyFallback && current.points.every(point => point.toolCalls === 0 && point.requests === 0);
  const infrastructureFailures = Number(current.infrastructureFailures || 0);
  return h(React.Fragment, null,
    h('section', { className: 'usage-overview', 'aria-label': t`${current.kind === 'workspace' ? current.label : t('All projects')} analytics for ${t(bounds.label)}` },
      fallback ? h('p', { className: 'usage-series-note' }, t('Hourly trends are unavailable for older monthly totals.')) : null,
      infrastructureFailures
        ? h('div', { className: 'connection-notice bad usage-infrastructure-alert', role: 'status' },
            h(Icon, { name: 'warning', size: 16 }),
            h('strong', null, infrastructureFailures === 1 ? t`${integer(infrastructureFailures)} Rel.AI internal error` : t`${integer(infrastructureFailures)} Rel.AI internal errors`),
            h('span', null, t(infrastructureFailures === 1 ? 'Confirmed infrastructure failure in this range.' : 'Confirmed infrastructure failures in this range.')),
            h('a', { href: routeHref('diagnostics') }, t('Open Troubleshooting'))
          )
        : null,
      h('div', { className: 'usage-metrics' }, analyticsMetrics(current, previous).map(metric => h(Metric, { key: metric.key, metric })))
    ),
    h('section', { className: 'card usage-timeline-card', 'data-usage-timeline': true },
      h('div', { className: 'card-head usage-timeline-head' },
        h('div', { className: 'usage-card-title' }, h(Icon, { name: 'activity', size: 17 }), h('h3', null, t('Activity'))),
        h('div', { className: 'usage-chart-switch', role: 'group', 'aria-label': t('Chart metric') }, CHART_METRICS.map(([key, label, icon]) => h('button', {
          key,
          type: 'button',
          className: `secondary compact-button${chartKey === key ? ' active' : ''}`,
          'data-usage-chart': key,
          'aria-pressed': chartKey === key ? 'true' : 'false',
          onClick: () => setChartKey(key)
        }, h(Icon, { name: icon, size: 15 }), h('span', null, t(label)))))
      ),
      h('div', { className: 'card-body usage-timeline-body', 'data-usage-chart-body': true },
        h(Timeline, { bounds, points: current.points, metricKey: chart[0], label: chart[1] })
      )
    ),
    h('div', { className: 'usage-side-by-side usage-distribution-grid' },
      h(DistributionCard, {
        title: t('Use cases'),
        description: Number(current.categorizedActions) === 1 ? t`${integer(current.categorizedActions)} categorized action` : t`${integer(current.categorizedActions)} categorized actions`,
        rows: current.useCases,
        valueKey: 'toolCalls',
        total: current.categorizedActions,
        labelFor: row => t(analyticsUseCaseLabel(row.useCase)),
        empty: Number(current.toolCalls || 0) > 0 ? t('Use-case analytics are available for activity recorded after this update.') : t('No activity in this range.'),
        note: current.legacyUncategorizedActions > 0
          ? Number(current.legacyUncategorizedActions) === 1 ? t`${integer(current.legacyUncategorizedActions)} earlier action does not include use-case data.` : t`${integer(current.legacyUncategorizedActions)} earlier actions do not include use-case data.`
          : ''
      }),
      h(DistributionCard, {
        title: t('Work types'),
        description: Number(current.completedTasks) === 1 ? t`${integer(current.completedTasks)} completed work session` : t`${integer(current.completedTasks)} completed work sessions`,
        rows: current.taskTypes,
        valueKey: 'tasks',
        total: current.completedTasks,
        labelFor: row => t(analyticsTaskIntentLabel(row.intent)),
        unit: 'task',
        empty: Number(current.toolCalls || 0) > 0
          ? t('No classified completed work sessions in this range. Work-type counts begin with tasks completed after this update.')
          : t('No completed work sessions in this range.')
      })
    ),
    h(ActivityMatrix, { current }),
    h(ActivityBars, { title: t('Actions by tool'), rows: current.tools, kind: 'tool' }),
    current.kind === 'workspace'
      ? h(FailureCategories, { rows: current.failureCategories, totalFailures: current.failures })
      : h('div', { className: 'usage-side-by-side' },
          h(FailureCategories, { rows: current.failureCategories, totalFailures: current.failures }),
          h(ActivityBars, { title: t('Project activity'), rows: current.workspaces, kind: 'workspace' })
        )
  );
}

function DistributionCard({ title, description = '', rows = [], valueKey, total = 0, labelFor, unit = 'action', empty = t('No activity in this range.'), note = '' }) {
  const visible = [...rows].filter(row => Number(row?.[valueKey] || 0) > 0).sort((a, b) => Number(b?.[valueKey] || 0) - Number(a?.[valueKey] || 0));
  const max = Math.max(1, ...visible.map(row => Number(row?.[valueKey] || 0)));
  return h('section', { className: 'card usage-breakdown usage-bar-card usage-distribution-card' },
    h('div', { className: 'card-head' },
      h('div', null, h('h3', null, title), description ? h('p', null, description) : null)
    ),
    h('div', { className: 'card-body' },
      visible.length
        ? h('div', { className: 'usage-bar-list' }, visible.map((row, index) => {
            const value = Number(row?.[valueKey] || 0);
            const label = labelFor(row);
            const percentage = total > 0 ? value / total * 100 : 0;
            const valueText = `${integer(value)} ${t(value === 1 ? unit : `${unit}s`)}, ${formatShare(percentage)}`;
            return h('div', { key: `${label}-${index}`, className: 'usage-bar-row usage-distribution-row' },
              h('span', { className: 'usage-bar-label', title: label }, label),
              h('progress', { max, value, 'aria-label': `${label}: ${valueText}`, 'aria-valuetext': valueText }, integer(value)),
              h('strong', { className: 'usage-distribution-value' }, h('span', null, formatShare(percentage)), h('small', null, integer(value)))
            );
          }))
        : h('div', { className: 'usage-breakdown-empty' }, empty),
      note ? h('p', { className: 'usage-card-note' }, note) : null
    )
  );
}

function ActivityMatrix({ current }) {
  const matrix = Array.isArray(current.activityMatrix) ? current.activityMatrix : [];
  const useCases = ANALYTICS_USE_CASES.filter(item => item.primary && isPrimaryAnalyticsUseCase(item.id));
  const intents = [...new Set(matrix.map(row => row.intent))]
    .sort((left, right) => analyticsTaskIntentLabel(left).localeCompare(analyticsTaskIntentLabel(right)));
  const trackedActions = matrix.reduce((sum, row) => sum + Number(row.toolCalls || 0), 0);
  const rowTotals = new Map(intents.map(intent => [intent, matrix.filter(row => row.intent === intent).reduce((sum, row) => sum + Number(row.toolCalls || 0), 0)]));
  const cells = matrix.map(row => ({
    x: useCases.findIndex(item => item.id === row.useCase),
    y: intents.indexOf(row.intent),
    value: Number(row.toolCalls || 0),
    useCase: row.useCase,
    intent: row.intent,
    useCaseLabel: t(analyticsUseCaseLabel(row.useCase)),
    intentLabel: t(analyticsTaskIntentLabel(row.intent)),
    share: Number(rowTotals.get(row.intent) || 0) > 0 ? Number(row.toolCalls || 0) / Number(rowTotals.get(row.intent)) * 100 : 0
  })).filter(cell => cell.x >= 0 && cell.y >= 0 && cell.value > 0);
  const untrackedNote = Number(current.untrackedActions || 0) > 0
    ? Number(current.untrackedActions) === 1 ? t`${integer(current.untrackedActions)} action was not linked to a work session and is excluded from this matrix.` : t`${integer(current.untrackedActions)} actions were not linked to a work session and are excluded from this matrix.`
    : '';
  return h('section', { className: 'card usage-breakdown usage-matrix-card', 'data-usage-matrix': true },
    h('div', { className: 'card-head' },
      h('div', null,
        h('h3', null, t('Work type × use case')),
        h('p', null, trackedActions === 1 ? t`${integer(trackedActions)} task-linked action. Bubble size shows action count.` : t`${integer(trackedActions)} task-linked actions. Bubble size shows action count.`)
      )
    ),
    h('div', { className: 'card-body usage-matrix-body' },
      cells.length && intents.length
        ? h('div', { className: 'usage-matrix-scroll' },
            h('div', { className: 'usage-matrix-stage' },
              h(Suspense, { fallback: h('div', { className: 'usage-chart-empty', role: 'status' }, t('Loading matrix…')) },
                h(AnalyticsBubbleMatrixChart, {
                  cells,
                  xLabels: useCases.map(item => t(analyticsUseCaseShortLabel(item.id))),
                  yLabels: intents.map(intent => t(analyticsTaskIntentLabel(intent))),
                  className: 'usage-matrix-chart',
                  ariaLabel: t('Work type by use case activity matrix')
                })
              )
            )
          )
        : h('div', { className: 'usage-breakdown-empty' }, Number(current.untrackedActions || 0) > 0
            ? t('No task-linked use-case activity in this range.')
            : Number(current.toolCalls || 0) > 0
              ? t('The work-type matrix is available for task-linked activity recorded after this update.')
              : t('No activity in this range.')),
      untrackedNote ? h('p', { className: 'usage-card-note' }, untrackedNote) : null
    )
  );
}

function formatShare(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(number >= 10 ? 0 : 1)}%`;
}

function Metric({ metric }) {
  const [open, setOpen] = useState(false);
  const helpId = `usage-metric-help-${metric.key}`;
  const sparkValues = Array.isArray(metric.values) ? metric.values : [];
  return h('article', { className: `usage-metric ${metric.tone}${open ? ' help-open' : ''}`.trim() },
    h('div', { className: 'usage-metric-label-row' },
      h('span', { className: 'usage-metric-label-main' },
        h(Icon, { name: METRIC_ICONS[metric.key] || 'usage', className: 'usage-metric-icon', size: 16 }),
        h('span', { className: 'usage-metric-label' }, t(metric.label))
      ),
      metric.help ? h('span', {
        className: `usage-metric-help${open ? ' is-open' : ''}`,
        onPointerEnter: () => setOpen(true),
        onPointerLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false)
      },
        h('button', {
          type: 'button',
          className: 'usage-metric-help-trigger',
          'aria-label': t`About ${t(metric.label)}`,
          'aria-describedby': helpId,
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen(value => !value),
          onKeyDown: event => {
            if (event.key === 'Escape') {
              setOpen(false);
              event.stopPropagation();
            }
          }
        }, h(Icon, { name: 'help', size: 17 })),
        h('span', { id: helpId, role: 'tooltip', className: 'usage-metric-tooltip' }, t(metric.help))
      ) : null
    ),
    h('div', { className: 'usage-metric-value' },
      h('strong', null, metric.value),
      metric.delta ? h('small', { className: `usage-delta ${metric.delta.tone || ''}`.trim() }, metric.delta.text) : null
    ),
    metric.detail ? h('small', { className: 'usage-metric-detail' }, t(metric.detail)) : null,
    sparkValues.length
      ? h(Suspense, { fallback: h('span', { className: 'usage-sparkline-empty', 'aria-hidden': 'true' }) },
        h(SparkChart, { values: sparkValues, className: `usage-sparkline ${metric.tone}`.trim(), tone: metric.tone }))
      : h('span', { className: 'usage-sparkline-empty', 'aria-hidden': 'true' })
  );
}

function Timeline({ bounds, points = [], metricKey, label }) {
  const values = points.map(point => pointMetric(point, metricKey));
  const model = timelineModel(values, label);
  const sparseMetric = metricKey === 'operationSuccessRate' || metricKey === 'averageDuration';
  const signature = `${metricKey}:${values.join('|')}`;
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, model.latestIndex || 0));

  useEffect(() => {
    setActiveIndex(Math.max(0, model.latestIndex || 0));
  }, [signature, model.latestIndex]);

  if (model.empty) return h('div', { className: 'usage-chart-empty' }, sparseMetric ? t('No measured samples in this range.') : t('No activity in this range.'));

  const safeIndex = Math.max(0, Math.min(model.latestIndex, activeIndex));
  const point = points[safeIndex];
  const readoutId = `usage-chart-readout-${metricKey}`;
  const selectedTime = formatPointTime(point, bounds, true);
  const selectedValue = formatChartValue(values[safeIndex], label);
  const peakValue = formatChartValue(model.peak, label);
  const labels = points.map(item => formatPointTime(item, bounds, false));
  const detailedLabels = points.map(item => formatPointTime(item, bounds, true));
  const firstMeasuredIndex = values.findIndex(value => value !== null);
  const leadingGapNote = sparseMetric && firstMeasuredIndex > 0
    ? t` No completed-action samples exist before ${detailedLabels[firstMeasuredIndex]}; the solid line begins at the first measured sample.`
    : '';
  const formatValue = value => formatChartValue(value, label);
  const gapHint = sparseMetric
    ? t(' Hourly data uses UTC buckets; shaded gaps mean no completed actions were recorded in those buckets.')
    : t(' Hourly data uses UTC buckets.');

  return h('div', { className: 'usage-timeline-plot' },
    h('div', { className: 'usage-chart-readout', id: readoutId },
      h('span', null, selectedTime),
      h('strong', null, selectedValue),
      h('small', null, safeIndex === model.peakIndex ? t('Peak in this range') : t`Peak ${peakValue}`)
    ),
    h('div', { className: 'usage-timeline-stage' },
      h(Suspense, { fallback: h('div', { className: 'usage-chart-empty', role: 'status' }, t('Loading chart…')) },
        h(AnalyticsTimelineChart, {
        values,
        labels,
        detailedLabels,
        className: 'usage-timeline-chart',
        ariaLabel: model.summary,
        ariaDescribedBy: readoutId,
        valueLabel: t(label),
        formatValue,
        missingValueLabel: sparseMetric ? t('No completed actions') : '',
        peakIndex: model.peakIndex,
        activeIndex: safeIndex,
        onActiveIndexChange: setActiveIndex
        }))
    ),
    h('div', { className: 'usage-chart-hint' }, t`Hover the chart or focus it and use ← / → to inspect exact values.${gapHint}${leadingGapNote}`)
  );
}

function FailureCategories({ rows = [], totalFailures = 0 }) {
  const visible = [...rows].sort((a, b) => b.failures - a.failures);
  const max = Math.max(1, ...visible.map(row => row.failures));
  return h('section', { className: 'card usage-breakdown usage-bar-card' },
    h('div', { className: 'card-head' },
      h('div', null, h('h3', null, t('Unsuccessful actions by reason')), h('p', null, t('Grouped by cause. Recent details are available in Troubleshooting.')))
    ),
    h('div', { className: 'card-body' }, visible.length
      ? h('div', { className: 'usage-bar-list' }, visible.map(row => h(BarRow, {
          key: row.category,
          label: t(failureCategoryLabel(row.category)),
          value: row.failures,
          max,
          unit: 'failure'
        })))
      : h('div', { className: 'usage-breakdown-empty' }, Number(totalFailures || 0) > 0 ? t('Problem types are unavailable for older data.') : t('No failures in this range.')))
  );
}

function ActivityBars({ title, rows = [], kind }) {
  const visible = [...rows].sort((a, b) => b.toolCalls - a.toolCalls);
  const max = Math.max(1, ...visible.map(row => row.toolCalls));
  return h('section', { className: 'card usage-breakdown usage-bar-card' },
    h('div', { className: 'card-head' }, h('h3', null, title)),
    h('div', { className: 'card-body' }, visible.length
      ? h('div', { className: 'usage-bar-list' }, visible.map((row, index) => {
          const label = kind === 'workspace' ? (row.workspace || t('Unattributed')) : (row.tool || t('Unknown tool'));
          const drilldown = kind === 'workspace' && Boolean(row.workspace);
          const inner = h(BarRowContent, { label, value: row.toolCalls, max, unit: 'action', drilldown });
          return drilldown
            ? h('a', {
                key: row.workspace,
                className: 'usage-bar-row usage-bar-link',
                href: routeHref('usage', { workspace: row.workspace }),
                'aria-label': t`View analytics for ${row.workspace}`,
                title: t`View analytics for ${row.workspace}`
              }, inner)
            : h('div', { key: `${label}-${index}`, className: 'usage-bar-row' }, inner);
        }))
      : h('div', { className: 'usage-breakdown-empty' }, t('No activity in this range.')))
  );
}

function BarRow({ label, value, max, unit = 'action' }) {
  return h('div', { className: 'usage-bar-row' }, h(BarRowContent, { label, value, max, unit }));
}

function BarRowContent({ label, value, max, unit = 'action', drilldown = false }) {
  const valueText = `${integer(value)} ${t(Number(value) === 1 ? unit : `${unit}s`)}`;
  return h(React.Fragment, null,
    h('span', { className: 'usage-bar-label', title: label }, label),
    h('progress', { max, value, 'aria-label': `${label}: ${valueText}`, 'aria-valuetext': valueText }, integer(value)),
    h('strong', { className: 'usage-bar-value' }, h('span', null, integer(value)), drilldown ? h(Icon, { name: 'chevronRight', size: 15 }) : null)
  );
}

function formatPointTime(point, bounds, detailed) {
  const at = Number(point?.at);
  if (!Number.isFinite(at)) return detailed ? t('Selected period') : '—';
  const date = new Date(at);
  const span = Math.max(0, Number(bounds?.end?.getTime?.() || 0) - Number(bounds?.start?.getTime?.() || 0));
  const options = detailed
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }
    : span <= 2 * 24 * 60 * 60 * 1000
      ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }
      : span <= 32 * 24 * 60 * 60 * 1000
        ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(getResolvedLanguage(), options).format(date);
}


function messageOf(error) {
  return error instanceof Error ? error.message : String(error || t('Analytics unavailable.'));
}
