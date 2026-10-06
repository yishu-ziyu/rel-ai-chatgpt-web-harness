import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const targetUrl = process.env.RELAI_PROBE_TARGET_URL;
const outputPath = process.env.RELAI_PROBE_OUTPUT_PATH;
const screenshotDir = process.env.RELAI_PROBE_SCREENSHOT_DIR;
const workspacePath = process.env.RELAI_PROBE_WORKSPACE_PATH;
const seedSignalPath = process.env.RELAI_PROBE_SEED_SIGNAL_PATH;
if (!targetUrl || !outputPath || !screenshotDir || !workspacePath || !seedSignalPath) throw new Error('Localization probe environment is incomplete.');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');

const result = { stage: 'starting', snapshots: {}, screenshots: {}, layout: {}, failures: [] };
const save = () => fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
save();

const readyTimeout = setTimeout(() => {
  result.error = 'Electron did not reach app ready within 15s.';
  result.stage = 'failed';
  save();
  app.quit();
}, 15_000);
app.whenReady().then(() => {
  clearTimeout(readyTimeout);
  return run();
}).catch(error => {
  result.error = error?.stack || String(error);
  result.stage = 'failed';
  save();
  app.quit();
});

async function run() {
  try {
    result.stage = 'electron_ready';
    save();
    const win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 800,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.webContents.on('render-process-gone', (_event, details) => result.failures.push(`renderer:${details.reason}`));
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) result.failures.push(`console:${message}`);
    });
    win.webContents.session.webRequest.onCompleted({ urls: ['http://*/*'] }, details => {
      if (details.statusCode >= 400) result.failures.push(`http:${details.statusCode}:${new URL(details.url).pathname}`);
    });
    result.stage = 'loading_dashboard';
    save();
    await win.loadURL(targetUrl);
    result.stage = 'dashboard_loaded';
    save();
    await waitFor(win, `document.querySelector('#uiLanguagePreference')`);
    await chooseLanguage(win, 'en');
    result.snapshots.englishInitial = await snapshot(win);
    await screenshot(win, 'english-settings');

    await chooseLanguage(win, 'zh-CN');
    result.snapshots.chineseSettings = await snapshot(win);
    await screenshot(win, 'chinese-settings');

    await route(win, 'workspaces', `[data-workspaces-react]`);
    result.snapshots.chineseEmptyProjects = await snapshot(win);
    await screenshot(win, 'chinese-projects-empty');
    await route(win, 'tasks', `[data-sessions-react]`);
    result.snapshots.chineseEmptyTasks = await snapshot(win);
    await screenshot(win, 'chinese-tasks-empty');
    await route(win, 'settings/connection', `[data-connection-react]`);
    result.snapshots.chineseConnection = await snapshot(win);
    await screenshot(win, 'chinese-connection');

    await route(win, 'workspaces', `[data-workspaces-react]`);
    await runProjectForm(win);
    result.snapshots.chineseProject = await snapshot(win);
    await screenshot(win, 'chinese-project');

    await route(win, 'settings', `#uiLanguagePreference`);
    await chooseLanguage(win, 'en');
    await route(win, 'workspaces', `[data-workspaces-react]`);
    result.snapshots.englishProject = await snapshot(win);
    await screenshot(win, 'english-project');

    await route(win, 'settings', `#uiLanguagePreference`);
    await chooseLanguage(win, 'zh-CN');
    await win.loadURL(targetUrl);
    await waitFor(win, `document.querySelector('#uiLanguagePreference')`);
    result.snapshots.chineseAfterReload = await snapshot(win);

    result.stage = 'need_task_seed';
    save();
    await waitForSignal(seedSignalPath);
    await win.loadURL(new URL('#tasks', targetUrl).href);
    await waitFor(win, `document.querySelector('[data-task-id="localization-task"]')`);
    result.snapshots.chineseTask = await snapshot(win);
    await win.webContents.executeJavaScript(`document.querySelector('[data-task-id="localization-task"]')?.click()`);
    await waitFor(win, `document.querySelector('[data-session-inspector] .task-detail-current span')?.textContent.trim() === 'Working locally'`);
    result.snapshots.chineseTaskDetail = await snapshot(win);
    await screenshot(win, 'chinese-task');
    await win.webContents.executeJavaScript(`document.querySelector('[data-task-id="localization-log-task"]')?.click()`);
    await waitFor(win, `document.querySelector('[data-session-inspector] .task-event-command code')?.textContent.trim() === 'npm run Overview Settings'`);
    result.snapshots.chineseLogTaskDetail = await snapshot(win);
    await screenshot(win, 'chinese-log-task');
    await route(win, 'activity', `.activity-message-copy`);
    result.snapshots.chineseActivity = await snapshot(win);
    await screenshot(win, 'chinese-activity');

    for (const size of [{ name: 'normal', width: 1180, height: 800 }, { name: 'minimum', width: 640, height: 720 }]) {
      win.setSize(size.width, size.height);
      for (const [name, target, ready] of [
        ['settings', 'settings', '#uiLanguagePreference'],
        ['projects', 'workspaces', '[data-workspaces-react]'],
        ['tasks', 'tasks', '[data-sessions-react]'],
        ['connection', 'settings/connection', '[data-connection-react]']
      ]) {
        await route(win, target, ready);
        result.layout[`${size.name}-${name}`] = await geometry(win);
        await screenshot(win, `chinese-${size.name}-${name}`);
      }
    }

    await route(win, 'settings', '#uiLanguagePreference');
    await chooseLanguage(win, 'system');
    await win.loadURL(targetUrl);
    await waitFor(win, `document.querySelector('#uiLanguagePreference')`);
    result.snapshots.systemAfterReload = await snapshot(win);
    await chooseLanguage(win, 'en');
    await win.loadURL(targetUrl);
    await waitFor(win, `document.querySelector('#uiLanguagePreference')`);
    result.snapshots.englishAfterReload = await snapshot(win);
    await screenshot(win, 'english-after-reload');
    result.stage = 'complete';
    save();
    win.destroy();
  } catch (error) {
    result.error = error?.stack || String(error);
    result.stage = 'failed';
    save();
  } finally {
    app.quit();
  }
}

async function runProjectForm(win) {
  await win.webContents.executeJavaScript(`document.querySelector('.workspace-toolbar button.primary')?.click()`);
  await waitFor(win, `document.querySelector('.modal-panel input[name="alias"]')`);
  await win.webContents.executeJavaScript(`(() => {
    const alias = document.querySelector('.modal-panel input[name="alias"]');
    const paths = document.querySelector('.modal-panel textarea[name="paths"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(alias, 'Settings');
    alias.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(paths, ${JSON.stringify(workspacePath)});
    paths.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('.ws-project-form')?.dataset.unsavedChanges === 'true'`);
  await win.webContents.executeJavaScript(`document.querySelector('.modal-close')?.click()`);
  await waitFor(win, `document.querySelector('.modal-inline-confirm-card')`);
  await win.webContents.executeJavaScript(`document.querySelector('.modal-inline-confirm-card .modal-actions .secondary')?.click()`);
  result.snapshots.draftAfterCancel = await snapshot(win);
  await win.webContents.executeJavaScript(`document.querySelector('.modal-panel button[type="submit"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-workspace-card="Settings"]') && !document.querySelector('#__relai-modal-backdrop')`, 15_000);
}

async function chooseLanguage(win, value) {
  await win.webContents.executeJavaScript(`(() => {
    const select = document.getElementById('uiLanguagePreference');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, `document.documentElement.dataset.languagePreference === ${JSON.stringify(value)} && document.getElementById('uiLanguagePreference')?.value === ${JSON.stringify(value)} && !document.getElementById('uiLanguagePreference')?.disabled`);
  if (value !== 'system') {
    await waitFor(win, `document.documentElement.lang === ${JSON.stringify(value)} && [...document.querySelectorAll('[data-nav-id="home"]')].some(element => element.textContent.trim() === ${JSON.stringify(value === 'zh-CN' ? '总览' : 'Overview')})`);
  }
}

async function route(win, pathName, selector) {
  await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#${pathName}`)}`);
  const activeId = pathName === 'settings' ? 'preferences' : pathName === 'settings/connection' ? 'connection' : pathName;
  await waitFor(win, `location.hash === ${JSON.stringify(`#${pathName}`)} && document.querySelector(${JSON.stringify(selector)}) && document.querySelector(${JSON.stringify(`[data-nav-id="${activeId}"][aria-current="page"]`)}) && !document.querySelector('.dashboard-state[aria-busy="true"]')`);
  await settlePaint(win);
}

async function snapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
    const value = selector => document.querySelector(selector)?.value || '';
    const nav = id => {
      const selector = id === 'settings' ? '[data-nav-accordion="settings"] > summary .nav-label' : '[data-nav-id="' + id + '"]';
      return [...document.querySelectorAll(selector)].find(element => element.getClientRects().length)?.textContent?.trim() || '';
    };
    return {
      lang: document.documentElement.lang,
      preference: document.getElementById('uiLanguagePreference')?.value || document.documentElement.dataset.languagePreference || '',
      route: location.hash,
      nav: Object.fromEntries(['home', 'tasks', 'workspaces', 'settings', 'connection'].map(id => [id, nav(id)])),
      title: text('#pageTitle'),
      settingsHeading: text('.settings-header h2'),
      projectsEmpty: text('.workspace-empty-state'),
      addProject: text('.workspace-toolbar button.primary'),
      tasksHeading: text('.sessions-history-card .card-head h3'),
      tasksEmpty: text('.sessions-page .task-list .empty'),
      connectionHeading: text('.connection-summary-card h3'),
      projectCard: text('[data-workspace-card="Settings"]'),
      projectName: text('[data-workspace-card="Settings"] .workspace-identity strong'),
      taskRow: text('[data-task-id="localization-task"]'),
      taskDetail: text('[data-session-inspector] .session-detail'),
      taskStage: text('[data-session-inspector] .task-detail-current strong'),
      taskSummary: text('[data-session-inspector] .task-detail-current span'),
      taskCommand: text('[data-session-inspector] .task-event-command code'),
      activity: [...document.querySelectorAll('.activity-message-copy')].map(element => element.textContent.trim()).join(' | '),
      draftAlias: value('.modal-panel input[name="alias"]'),
      draftPath: value('.modal-panel textarea[name="paths"]'),
      draftOpen: Boolean(document.querySelector('.modal-panel'))
    };
  })()`);
}

async function geometry(win) {
  return win.webContents.executeJavaScript(`(() => {
    const visible = element => element && getComputedStyle(element).display !== 'none' && element.getClientRects().length;
    const controls = [...document.querySelectorAll('#pageTitle, .feature-toolbar button, .connection-support-row button, #uiLanguagePreference, .task-row')].filter(visible);
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      loading: Boolean(document.querySelector('.dashboard-state[aria-busy="true"]')),
      clippedControls: controls.filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1); }).map(element => element.outerHTML.slice(0, 120))
    };
  })()`);
}

async function screenshot(win, name) {
  await settlePaint(win);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const file = path.join(screenshotDir, `${name}.png`);
  await win.webContents.capturePage().then(image => fs.writeFileSync(file, image.toPNG()));
  result.screenshots[name] = file;
  save();
}

async function settlePaint(win) {
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function waitFor(win, expression, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function waitForSignal(file) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for task seed signal ${file}`);
}
