import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { copyText } from '../../clipboard.js';
import { t } from '../../i18n.js';
import { useUiLanguage } from '../../i18n-react.js';
import { Icon } from '../../components/icons.js';
import { pillClass } from '../../components/pill.js';
import { taskProgressView } from '../../components/task-progress.js';
import { toast } from '../../components/toast.js';
import { routeMetadata } from '../../navigation-catalog.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { statusTone } from '../../status-tone.js';
import { workSessionStateView } from '../../task-identity.js';
import { classifyTaskActivity } from '../../../taskActivityPresentation.js';
import { formatDuration, timeAgo } from '../../utils.js';
import { buildTaskSemanticProgress } from '../../../taskSemanticProgress.js';
import { completeDesktopSetup, desktopSetupSteps, dismissDesktopSetup, isDesktopSetupDismissed } from '../onboarding/index.js';
import { CHATGPT_CONNECTOR_CREATE_URL, RELAI_CONNECTOR_ICON_FILENAME, chatGptFirstPrompt, chatGptGuideSteps, downloadRelaiConnectorIcon } from '../settings/connection-guidance.js';
import { loadAnalyticsData } from '../usage/data.js';
import { desktopSetupState, homeAnalyticsView, overviewState, overviewWorkspaceStatus } from './index.js';

const h = React.createElement;
const SparkChart = lazy(() => import('../../components/charts.js').then(module => ({ default: module.SparkChart })));
const HOME_STORE_KEYS = Object.freeze(['config', 'health', 'connection', 'connectionState', 'desktopStatus', 'mcpConnection', 'tasks', 'taskActivity', 'live']);

export function createHomeRoute(useDashboardSlices) {
  return function HomeRoute() {
    return h(HomeView, { data: useDashboardSlices(HOME_STORE_KEYS) });
  };
}

function HomeView({ data = {} }) {
  const language = useUiLanguage();
  const workspace = getWorkspaceFilter();
  const state = useMemo(() => overviewState(data, workspace), [data, workspace, language]);
  const setup = useMemo(() => desktopSetupState(data), [data]);
  const activeCard = taskActivityModel(data.taskActivity, state.tasks[0]);
  return h('div', { className: 'section', 'data-home-react': '' },
    activeCard ? h(TaskActivityCard, { model: activeCard }) : null,
    h(DesktopSetupChecklist, { setup }),
    h(ConnectionHero, { state: state.bridgeState }),
    h(HomeAnalytics, { taskRevision: Number(data.live?.revisions?.task || 0), workspace }),
    h('div', { className: 'layout-grid' },
      h(WorkspaceSummaryCard, { workspaces: state.workspaces, findings: state.findings }),
      h(RecentTasksCard, { tasks: state.tasks })
    )
  );
}

function ConnectionHero({ state }) {
  return h('section', { className: `overview-hero overview-hero-compact ${state.tone}`, 'data-home-live-connection': '' },
    h('div', { className: 'overview-copy' },
      h('div', { className: 'overview-kicker' }, t(state.kicker)),
      h('h2', { className: 'overview-title' }, t(state.title)),
      h('p', { className: 'overview-description' }, t(state.description))
    ),
    h('a', { className: 'buttonlike secondary compact-button', href: routeMetadata('settings/connection').href }, t('View connection'))
  );
}

function TaskActivityCard({ model }) {
  const task = model.task;
  if (model.active) {
    const startedAt = task.startedAtIso || task.createdAt || task.startedAt || '';
    const startedAtMs = Date.parse(startedAt) || Number(task.startedAt || Date.now());
    const stateClass = model.attention ? 'attention' : model.waiting ? 'waiting' : 'active';
    return h('section', { className: `card task-overview ${stateClass}`, 'data-home-live-activity': '' },
      h('div', { className: 'task-overview-mark', 'aria-hidden': 'true' }, model.attention ? '!' : model.waiting ? '…' : h('span', { className: 'task-overview-spinner' })),
      h('div', { className: 'task-overview-copy' },
        h('div', { className: 'overview-kicker' }, t('Current task')),
        h('h3', null, task.title || model.title),
        h('p', null, model.description),
        h(TaskProgress, { progress: task.progress, status: task.status, compact: true })
      ),
      h('div', { className: 'task-overview-meta' },
        h('span', null, t(model.activityLabel)),
        h('strong', { 'data-clock-elapsed-start': startedAt }, formatDuration(Date.now() - startedAtMs, { live: true }))
      )
    );
  }
  return h('section', { className: `card task-overview ${model.tone}`, 'data-home-live-activity': '' },
    h('div', { className: 'task-overview-mark', 'aria-hidden': 'true' }, model.mark),
    h('div', { className: 'task-overview-copy' },
      h('div', { className: 'overview-kicker' }, t('Previous task')),
      h('h3', null, task.title || model.title),
      h('p', null, model.description),
      h(TaskProgress, { progress: task.progress, status: task.status, compact: true })
    ),
    h('div', { className: 'task-overview-meta' },
      h('span', { 'data-clock-relative': task.endedAt || task.completedAt || '' }, timeAgo(task.endedAt || task.completedAt)),
      h('strong', null, formatDuration(task.durationMs))
    )
  );
}

function taskActivityModel(activity = {}, persistedTask = null) {
  const presentation = classifyTaskActivity(activity);
  const activeTasks = presentation.tasks;
  const active = presentation.category !== 'idle';
  const completedWithWarnings = persistedTask?.status === 'completed' && Number(persistedTask?.failedToolCallCount ?? persistedTask?.failures ?? 0) > 0;
  if (!active && !['failed', 'blocked', 'validation_failed'].includes(persistedTask?.status) && !completedWithWarnings) return null;
  const task = active ? presentation.primaryTask || primaryActiveTask(activeTasks) : persistedTask || activity.lastTask;
  if (!task) return null;
  if (active) {
    const activeCalls = presentation.activeCalls;
    const attention = presentation.category === 'attention';
    const waiting = presentation.category === 'waiting';
    const semantic = semanticProgressFor(task);
    const operation = semantic.currentActivity || task.currentActivity || task.operation || taskAction(task.lastTool || task.tool);
    const stage = String(semantic.currentStage ? t(semantic.currentStage) : t('Task progress')).trim();
    const activityText = String(semantic.currentActivity || '').trim();
    const location = task.workspace || activeTaskLocation(activeTasks);
    let title = task.title || operation || t('Current task');
    let description = activityText && activityText !== stage ? `${stage} · ${activityText}` : stage || activityText || t('Task is open');
    description = location ? t`${description} in ${location}.` : `${description}.`;
    if (!task.title && !attention && !waiting && activeTasks.length > 1) title = t`${activeCalls} Rel.AI actions are running.`;
    if (!attention && !waiting && activeTasks.length > 1) description = t`${activeCalls} ${t(pluralLabel(activeCalls, 'active action'))} across ${activeTaskLocation(activeTasks)}.`;
    return {
      active: true,
      attention,
      waiting,
      task,
      title,
      description,
      stage,
      activity: activityText,
      location,
      activityLabel: attention
        ? t`Action required · ${statusLabel(task.status)}`
        : waiting
          ? t`${statusLabel(task.status)} · latest progress`
          : t`${activeCalls} ${t(pluralLabel(activeCalls, 'active call'))}`
    };
  }
  const attention = ['failed', 'blocked', 'validation_failed'].includes(task.status);
  const completed = task.status === 'completed' && task.completionKnown === true;
  const failed = Number(task.failures || 0);
  const callCount = Number(task.calls || 0);
  let mark = '•';
  let title = 'Last task is inactive';
  if (attention) {
    mark = '!';
    title = task.status === 'blocked' ? 'Last task was blocked' : task.status === 'validation_failed' ? 'Last task needs attention' : 'Last task failed';
  } else if (completed) {
    mark = '✓';
    title = 'Task completed';
  }
  const failureText = failed ? completed ? (failed === 1 ? t` · ${failed} warning` : t` · ${failed} warnings`) : t` · ${failed} failed` : '';
  const completionText = completed ? t` · ${task.summary || t('final checks passed')}` : t(' · ChatGPT did not report a final result');
  return { active: false, task, mark, title: t(title), tone: attention ? 'attention' : completed ? 'completed' : 'waiting', description: `${task.workspace || t('project')} · ${callCount} ${t(pluralLabel(callCount, 'action'))}${failureText}${completionText}` };
}

function WorkspaceSummaryCard({ workspaces, findings }) {
  return h('section', { className: 'card', 'data-home-live-workspaces': '' },
    h('div', { className: 'card-head' }, h('h3', null, t('Projects')), h('a', { className: 'section-action', href: routeMetadata('workspaces').href }, t('Manage'))),
    h('div', { className: 'card-body compact-workspace-list' },
      workspaces.length ? workspaces.slice(0, 6).map(workspace => h('div', { className: 'compact-workspace', key: workspace.alias || workspace.path },
        h('div', null, h('strong', null, workspace.alias || t('project')), h('div', { className: 'compact-workspace-path' }, workspace.path || '')),
        h(StatusPill, { value: overviewWorkspaceStatus(workspace, findings) })
      )) : h('div', { className: 'empty' }, t('No projects added yet. '), h('a', { className: 'buttonlike secondary compact-button', href: routeMetadata('workspaces').href }, t('Add your first project')))
    )
  );
}

function RecentTasksCard({ tasks }) {
  return h('section', { className: 'card', 'data-home-live-sessions': '' },
    h('div', { className: 'card-head' }, h('h3', null, t('Latest tasks')), h('a', { className: 'section-action', href: routeHref('tasks') }, t('See all tasks'))),
    h('div', { className: 'card-body' },
      tasks.length ? tasks.slice(0, 5).map(task => {
        const endedAt = task.endedAt || task.completedAt;
        const warnings = task.status === 'completed' ? Number(task.failedToolCallCount ?? task.failures ?? 0) : 0;
        const warningText = warnings ? (warnings === 1 ? t` · ${warnings} warning` : t` · ${warnings} warnings`) : '';
        const taskId = String(task.id || task.taskId || task.work_id || '').trim();
        return h('a', { className: 'activity-row', href: routeHref('tasks', { workspace: task.workspace || '', task: taskId }), key: taskId || `${task.workspace}-${endedAt || task.startedAt || ''}` },
          h('span', { className: 'activity-time', 'data-clock-relative': endedAt || undefined }, endedAt ? timeAgo(endedAt) : t('now')),
          h('span', { className: 'activity-name truncate' }, h('strong', null, task.title || task.operation || taskAction(task.lastTool)), t` · ${task.workspace || t('project')} · ${task.toolCallCount ?? task.calls ?? 0} actions${warningText}`),
          h(StatusPill, recentTaskStatusProps(task))
        );
      }) : h('div', { className: 'empty' }, t('Tasks will appear here after ChatGPT starts using Rel.AI on a project.'))
    )
  );
}

function HomeAnalytics({ taskRevision, workspace }) {
  const [analytics, setAnalytics] = useState({ scope: null, error: false, loading: true });
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setAnalytics(current => ({ ...current, loading: !current.scope, error: false }));
      void loadAnalyticsData({ desktop: globalThis.window?.relaiDesktop, range: '24h', now: new Date(), workspace })
        .then(({ current }) => { if (active) setAnalytics({ scope: current, error: false, loading: false }); })
        .catch(() => { if (active) setAnalytics(current => ({ ...current, error: true, loading: false })); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [taskRevision, workspace]);
  if (analytics.scope) return h(HomeAnalyticsContent, { scope: analytics.scope, refreshing: analytics.loading });
  return h('section', { className: 'card home-analytics-card', 'data-home-analytics': '', 'aria-busy': analytics.loading ? 'true' : 'false' },
    h('div', { className: 'card-head home-analytics-head' },
      h('div', null, h('h3', null, t('Activity')), h('p', null, analytics.error ? t('Activity could not be loaded.') : t('Loading activity…'))),
      h('a', { className: 'buttonlike secondary compact-button', href: routeHref('usage', workspace ? { workspace } : {}) }, t('View analytics'))
    ),
    analytics.loading ? h('div', { className: 'home-analytics-loading', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span')) : null
  );
}

function HomeAnalyticsContent({ scope, refreshing }) {
  const view = homeAnalyticsView(scope);
  return h('section', { className: 'card home-analytics-card', 'data-home-analytics': '', 'aria-busy': refreshing ? 'true' : 'false' },
    h('div', { className: 'card-head home-analytics-head' },
      h('div', null, h('div', { className: 'home-analytics-title-row' }, h(Icon, { name: 'usage', className: 'home-analytics-title-icon', size: 17 }), h('h3', null, t(view.heading)), h('span', null, t('24h · hourly')))),
      h('a', { className: 'buttonlike secondary compact-button home-analytics-link', href: routeHref('usage', view.workspaceScoped ? { workspace: view.workspace } : {}) }, h('span', null, t('View analytics')), h(Icon, { name: 'chevronRight', size: 15 }))
    ),
    h('div', { className: 'home-analytics-body' },
      h('div', { className: 'home-analytics-metrics' }, view.metrics.map(metric => h('div', { className: 'home-analytics-metric', key: metric.label }, h('div', { className: 'home-analytics-metric-label' }, h(Icon, { name: homeAnalyticsMetricIcon(metric.label), size: 15 }), h('span', null, t(metric.label))), h('strong', null, metric.value), metric.detail ? h('small', null, t(metric.detail)) : null))),
      h('div', { className: 'home-analytics-pulse' }, h('div', { className: 'home-analytics-pulse-head' }, h('div', null, h('span', null, t('Hourly activity')), h('strong', null, t(view.contextSummary))), h('small', null, 'UTC')), h(HomeAnalyticsPulse, { pulse: view.pulse })),
      view.errorSummary
        ? h('div', { className: 'home-analytics-foot bad', role: 'status' },
            h('span', null, t(view.errorSummary)),
            h('a', { href: routeHref('diagnostics') }, t('Open Troubleshooting'))
          )
        : null
    )
  );
}

function homeAnalyticsMetricIcon(label) {
  if (label === 'Successful actions') return 'success';
  if (label === 'Average time' || label === 'Total execution time') return 'timer';
  if (label === 'Active projects') return 'workspaces';
  return 'activity';
}

function HomeAnalyticsPulse({ pulse }) {
  if (pulse.empty) return h('div', { className: 'home-analytics-pulse-empty' }, t('No activity yet.'));
  return h('div', { className: 'home-analytics-chart' },
    h(Suspense, { fallback: h('div', { className: 'home-analytics-chart-canvas chart-loading', 'aria-hidden': 'true' }) },
      h(SparkChart, {
        values: pulse.values,
        className: 'home-analytics-chart-canvas',
        ariaLabel: t(pulse.summary),
        decorative: false
      })
    ),
    h('div', { className: 'home-analytics-scale' }, h('span', null, t('Earlier')), h('span', null, t('Current hour')))
  );
}

function DesktopSetupChecklist({ setup }) {
  const [dismissed, setDismissed] = useState(() => isDesktopSetupDismissed());
  const [copyState, setCopyState] = useState('idle');
  const steps = desktopSetupSteps(setup);
  const remaining = steps.filter(item => !item.complete);
  const current = steps.find(item => !item.complete && !item.locked) || remaining[0];
  const completedCount = steps.length - remaining.length;
  useEffect(() => {
    const onState = event => setDismissed(event?.detail?.pending !== true);
    window.addEventListener('relai:onboarding-state', onState);
    return () => window.removeEventListener('relai:onboarding-state', onState);
  }, []);
  useEffect(() => { if (!remaining.length) void completeDesktopSetup(); }, [remaining.length]);
  if (!remaining.length || dismissed) return null;
  const dismiss = async () => {
    setDismissed(true);
    await dismissDesktopSetup();
    toast(t('Getting started guide dismissed.'), { variant: 'info' });
  };
  const copyPrompt = async () => {
    try {
      await copyText(chatGptFirstPrompt(setup.workspaceAlias));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch { toast(t('Clipboard access failed.'), { variant: 'error' }); }
  };
  return h('section', { className: 'card desktop-setup-checklist', 'data-desktop-setup-checklist': '' },
    h('div', { className: 'card-head desktop-setup-head' },
      h('div', null, h('span', { className: 'desktop-setup-eyebrow' }, t('Getting started')), h('h3', null, t('Get Rel.AI working with ChatGPT')), h('p', null, t`${completedCount} of ${steps.length} steps complete. Follow the highlighted step.`)),
      h('button', { className: 'secondary compact-button', type: 'button', onClick: dismiss }, t('Dismiss guide'))
    ),
    h('div', { className: 'card-body desktop-setup-items' }, steps.map((item, index) => h(DesktopSetupStep, { key: item.id, item, index, current: item.id === current?.id, setup, copyState, onCopy: copyPrompt })))
  );
}

function DesktopSetupStep({ item, index, current, setup, copyState, onCopy }) {
  const state = item.complete ? 'Done' : item.locked ? 'Not ready' : current ? 'Next' : 'Ready';
  const className = `desktop-setup-item${item.complete ? ' done' : ''}${current ? ' current' : ''}${item.locked ? ' locked' : ''}`;
  return h('div', { className },
    h('span', { className: 'desktop-setup-index', 'aria-hidden': 'true' }, item.complete ? '✓' : index + 1),
    h('div', { className: 'desktop-setup-copy' },
      h('div', { className: 'desktop-setup-title-row' }, h('strong', null, t(item.title)), h('span', { className: 'desktop-setup-state' }, t(state))),
      h('p', null, t(item.description)),
      item.id === 'first-request' && current ? h('div', { className: 'desktop-first-request' }, h('span', null, t('Paste this into ChatGPT')), h('code', null, chatGptFirstPrompt(setup.workspaceAlias))) : null,
      item.id === 'chatgpt' && current ? h(ChatGptSetupGuide, { tunnelId: setup.tunnelId }) : null
    ),
    setupAction(item, current, copyState, onCopy)
  );
}

function setupAction(item, current, copyState, onCopy) {
  if (item.complete || item.locked || item.actionType === 'guide') return null;
  if (item.actionType === 'copy') return h('button', { className: `${current ? 'primary' : 'secondary'} compact-button`, type: 'button', onClick: onCopy }, copyState === 'copied' ? t('Copied') : t(item.action));
  return h('a', { className: `buttonlike ${current ? 'primary' : 'secondary'} compact-button`, href: item.href }, t(item.action));
}

function ChatGptSetupGuide({ tunnelId }) {
  const steps = chatGptGuideSteps({ mode: 'create', tunnelId });
  const [iconSaved, setIconSaved] = useState(false);
  const saveIcon = () => {
    downloadRelaiConnectorIcon();
    setIconSaved(true);
  };
  return h('div', { className: 'chatgpt-setup-guide compact desktop-chatgpt-guide' },
    h('div', { className: 'chatgpt-guide-heading' }, h('strong', null, t('Finish ChatGPT setup')), h('span', null, t('Use Tunnel + No authentication. Rel.AI keeps the local connection private.'))),
    h('section', { className: 'chatgpt-connector-handoff', 'aria-label': t('ChatGPT connector setup') },
      h('dl', { className: 'chatgpt-connector-values' }, h('dt', null, t('Name')), h('dd', null, 'Rel.AI MCP'), h('dt', null, t('Connection')), h('dd', null, t('Tunnel')), h('dt', null, t('Tunnel')), h('dd', { className: 'mono' }, tunnelId || t('Select this computer’s tunnel')), h('dt', null, t('Authentication')), h('dd', null, t('No authentication'))),
      h('div', { className: 'chatgpt-connector-actions', role: 'group', 'aria-label': t('ChatGPT connector setup actions') },
        h('button', { className: 'primary', type: 'button', onClick: () => window.open(CHATGPT_CONNECTOR_CREATE_URL, '_blank', 'noopener,noreferrer') }, t('ChatGPT setup')),
        h('button', { className: 'secondary', type: 'button', onClick: saveIcon }, iconSaved ? t`Optional icon saved · ${RELAI_CONNECTOR_ICON_FILENAME}` : h(React.Fragment, null, t('Save optional Rel.AI icon '), h('span', null, t('PNG · under 10 KB'))))
      ),
      h('p', { className: 'chatgpt-connector-note' }, iconSaved ? t('The icon is optional. Open ChatGPT setup when you are ready.') : t('Open ChatGPT now. You can add the Rel.AI icon after the connector works.'))
    ),
    h('ol', null, steps.map(step => h('li', { key: step }, t(step))))
  );
}

function primaryActiveTask(tasks) { return tasks.find(item => Number(item.activeCalls || 0) > 0) || tasks[0]; }
function semanticProgressFor(task = {}) { return task.semanticProgress && typeof task.semanticProgress === 'object' ? task.semanticProgress : buildTaskSemanticProgress(task); }
function activeTaskLocation(tasks) {
  const workspaces = [...new Set(tasks.map(item => item.workspace).filter(Boolean))];
  if (workspaces.length === 1) return workspaces[0];
  if (workspaces.length > 1) return t`${workspaces.length} projects`;
  return t('your projects');
}
function taskAction(tool) {
  const value = String(tool || '');
  if (/run_checks|browser/.test(value)) return t('Checking changes');
  if (/diff|git_status/.test(value)) return t('Reviewing changes');
  if (/git_draft_pr|git_create_pr/.test(value)) return t('Preparing pull request text');
  if (/git_commit|git_push/.test(value)) return t('Publishing changes');
  if (/edit|write|replace|tidy_run|restore|reset_workspace/.test(value)) return t('Applying changes');
  return t('Looking through the project');
}
function StatusPill({ value, classOverride = '' }) {
  const cls = String(classOverride || pillClass(value)).trim();
  return h('span', { className: `status-pill${cls ? ` ${cls}` : ''}` },
    t(String(value || 'unknown')),
    h('span', { className: 'sr-only' }, ` (${t(statusTone(value))})`)
  );
}

function TaskProgress({ progress, status, compact = false }) {
  const view = taskProgressView(progress, status, { compact });
  const attributes = {
    className: view.className,
    role: view.role || undefined,
    'aria-label': t(view.ariaLabel) || undefined
  };
  const label = h('div', { className: 'task-progress-label' },
    h('span', null, t(view.label)),
    view.state ? h('strong', null, t(view.state)) : null
  );
  if (view.kind === 'static') return h('div', attributes, label);
  if (view.kind === 'indeterminate') {
    return h('div', attributes,
      label,
      h('div', { className: 'task-progress-track', 'aria-hidden': 'true' })
    );
  }
  return h('div', attributes,
    label,
    h('progress', {
      className: 'task-progress-track',
      'aria-label': t(view.progressAriaLabel),
      value: view.value,
      max: 100
    })
  );
}

function recentTaskStatusProps(task) {
  const status = String(task?.status || '');
  if (status === 'failed') return { value: 'failed' };
  if (status === 'blocked') { const state = workSessionStateView(task); return { value: state.label.toLowerCase(), classOverride: state.pillClass }; }
  if (status === 'completed') return { value: 'completed' };
  if (status === 'running' || status === 'working') return { value: 'running' };
  if (status === 'validating') return { value: 'validating' };
  if (status === 'validation_failed') return { value: 'validation failed' };
  if (status === 'expired') return { value: 'expired' };
  if (status === 'inactive') return { value: 'inactive' };
  if (status === 'cancelled') return { value: 'cancelled' };
  if (['queued', 'planning', 'waiting_for_approval', 'waiting', 'settling'].includes(status)) return { value: 'open' };
  return { value: 'unknown' };
}
function statusLabel(status) { return String(status || 'open').replaceAll('_', ' '); }
function pluralLabel(count, singular) { return Number(count) === 1 ? singular : `${singular}s`; }
