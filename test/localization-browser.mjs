import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTaskHistoryDir, writeSession } from '../src/taskHistoryStorage.ts';
import { availablePort } from './helpers/available-port.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-localization-'));
const evidence = path.resolve(process.env.RELAI_LOCALIZATION_OUTPUT_DIR || path.join(os.tmpdir(), `relai-localization-evidence-${Date.now()}`));
const screenshots = path.join(evidence, 'screenshots');
const probeOutput = path.join(temp, 'probe.json');
const seedSignal = path.join(temp, 'seed-done');
const stateDir = path.join(temp, 'state');
const workspace = path.join(temp, 'Overview Settings');
const configPath = path.join(temp, 'config.json');
const port = await availablePort();
const token = 'localization-browser-token';
const config = {
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {}
};
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'overview-settings-fixture', version: '1.0.0' }));
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const server = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath, REL_AI_MCP_TOKEN: token, REL_AI_MCP_STATE_DIR: stateDir }
});
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString('utf8'); });
let electron = null;
let electronClose = Promise.resolve([]);
let electronOutput = '';

try {
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  const electronPackage = path.join(root, 'electron', 'node_modules', 'electron');
  const electronPathFile = path.join(electronPackage, 'path.txt');
  const electronBinary = process.env.RELAI_ELECTRON_BINARY || (
    fs.existsSync(electronPathFile)
      ? path.join(electronPackage, 'dist', fs.readFileSync(electronPathFile, 'utf8').trim())
      : path.join(electronPackage, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  );
  assert.ok(fs.existsSync(electronBinary), `Electron binary not found at ${electronBinary}`);
  electron = spawn(electronBinary, [
    '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer',
    `--user-data-dir=${path.join(temp, 'electron-profile')}`,
    path.join(root, 'test', 'fixtures', 'electron-localization-probe')
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: electronEnvironment({
      RELAI_PROBE_TARGET_URL: `http://127.0.0.1:${port}/dashboard?token=${encodeURIComponent(token)}#settings`,
      RELAI_PROBE_OUTPUT_PATH: probeOutput,
      RELAI_PROBE_SCREENSHOT_DIR: screenshots,
      RELAI_PROBE_WORKSPACE_PATH: workspace,
      RELAI_PROBE_SEED_SIGNAL_PATH: seedSignal
    })
  });
  electron.stdout.on('data', chunk => { electronOutput += chunk.toString('utf8'); });
  electron.stderr.on('data', chunk => { electronOutput += chunk.toString('utf8'); });
  electronClose = once(electron, 'close').catch(() => []);
  await waitForProbe(probeOutput, value => ['need_task_seed', 'failed'].includes(value.stage), 90_000);
  const beforeSeed = JSON.parse(fs.readFileSync(probeOutput, 'utf8'));
  if (beforeSeed.error) throw new Error(beforeSeed.error);
  seedTask(getTaskHistoryDir(config));
  fs.writeFileSync(seedSignal, 'ready');
  const result = await waitForProbe(probeOutput, value => ['complete', 'failed'].includes(value.stage), 90_000);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  assert.equal(result.error, undefined, result.error || electronOutput);
  assert.deepEqual(result.failures, [], JSON.stringify(result.failures));
  assert.equal(result.snapshots.englishInitial.lang, 'en');
  assert.equal(result.snapshots.englishInitial.nav.home, 'Overview');
  assert.equal(result.snapshots.englishInitial.settingsHeading, 'Preferences');
  assert.equal(result.snapshots.chineseSettings.lang, 'zh-CN');
  assert.equal(result.snapshots.chineseSettings.nav.home, '总览');
  assert.equal(result.snapshots.chineseSettings.nav.tasks, '任务');
  assert.equal(result.snapshots.chineseSettings.nav.workspaces, '项目');
  assert.equal(result.snapshots.chineseSettings.nav.settings, '设置');
  assert.equal(result.snapshots.chineseSettings.settingsHeading, '偏好设置');
  assertChinese(result.snapshots.chineseSettings.title, 'Settings page title');
  assertChinese(result.snapshots.chineseEmptyProjects.projectsEmpty, 'empty Projects state');
  assert.doesNotMatch(result.snapshots.chineseEmptyProjects.projectsEmpty, /Add your first project|Select a local folder/);
  assertChinese(result.snapshots.chineseEmptyProjects.addProject, 'Add project control');
  assert.doesNotMatch(result.snapshots.chineseEmptyProjects.addProject, /Add project/);
  assertChinese(result.snapshots.chineseEmptyTasks.tasksHeading, 'Tasks heading');
  assertChinese(result.snapshots.chineseEmptyTasks.tasksEmpty, 'empty Tasks state');
  assert.doesNotMatch(result.snapshots.chineseEmptyTasks.tasksEmpty, /No tasks yet/);
  assertChinese(result.snapshots.chineseConnection.connectionHeading, 'Connection heading');
  assert.doesNotMatch(result.snapshots.chineseConnection.connectionHeading, /ChatGPT connection/);
  assert.equal(result.snapshots.chineseConnection.nav.connection, '连接');
  assertChinese(result.snapshots.chineseConnection.title, 'Connection page title');
  assert.doesNotMatch(result.snapshots.chineseConnection.title, /Settings|Connection/);
  assert.equal(result.snapshots.draftAfterCancel.draftOpen, true);
  assert.equal(result.snapshots.draftAfterCancel.draftAlias, 'Settings');
  assert.equal(result.snapshots.draftAfterCancel.draftPath, workspace);
  assert.equal(result.snapshots.chineseProject.projectName, 'Settings');
  assert.ok(result.snapshots.chineseProject.projectCard.includes(workspace));
  assert.equal(result.snapshots.englishProject.projectName, 'Settings');
  assert.equal(result.snapshots.chineseAfterReload.lang, 'zh-CN');
  assert.equal(result.snapshots.chineseAfterReload.preference, 'zh-CN');
  assert.equal(result.snapshots.chineseAfterReload.nav.home, '总览');
  assert.ok(result.snapshots.chineseTask.taskRow.includes('Running'));
  assert.ok(result.snapshots.chineseTaskDetail.taskDetail.includes('Keep Overview Settings path unchanged'));
  assert.equal(result.snapshots.chineseTaskDetail.taskStage, '正在处理任务');
  assert.equal(result.snapshots.chineseTaskDetail.taskSummary, 'Working locally');
  assert.ok(result.snapshots.chineseLogTaskDetail.taskDetail.includes('LOG Overview Settings command'));
  assert.equal(result.snapshots.chineseLogTaskDetail.taskCommand, 'npm run Overview Settings');
  assert.ok(result.snapshots.chineseActivity.activity.includes('LOG Overview Settings command'));
  assert.ok(result.snapshots.chineseActivity.activity.includes('Working locally'));
  assert.equal(result.snapshots.systemAfterReload.preference, 'system');
  assert.ok(['en', 'zh-CN'].includes(result.snapshots.systemAfterReload.lang));
  assert.equal(result.snapshots.englishAfterReload.lang, 'en');
  assert.equal(result.snapshots.englishAfterReload.preference, 'en');
  assert.equal(result.snapshots.englishAfterReload.nav.home, 'Overview');
  for (const [name, measurement] of Object.entries(result.layout)) {
    assert.equal(measurement.overflow, false, `${name} overflows: ${JSON.stringify(measurement)}`);
    assert.equal(measurement.loading, false, `${name} was measured before the page finished loading`);
    assert.deepEqual(measurement.clippedControls, [], `${name} clips controls`);
  }
  for (const file of Object.values(result.screenshots)) assert.ok(fs.existsSync(file) && fs.statSync(file).size > 1000, `Missing or empty screenshot: ${file}`);
  await electronClose;
  console.log(`Rel.AI localization browser acceptance passed. Evidence: ${evidence}`);
} catch (error) {
  if (fs.existsSync(probeOutput)) fs.copyFileSync(probeOutput, path.join(evidence, 'result.json'));
  throw new Error(`${error?.stack || error}\nElectron output: ${electronOutput}\nServer stderr: ${serverError}\nEvidence: ${evidence}`, { cause: error });
} finally {
  if (electron && electron.exitCode == null) electron.kill('SIGKILL');
  await electronClose.catch(() => {});
  if (server.exitCode == null && server.signalCode == null) {
    server.kill('SIGKILL');
    await once(server, 'close').catch(() => {});
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function electronEnvironment(extra = {}) {
  const env = { ...process.env, ...extra, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

function seedTask(directory) {
  const now = Date.now();
  writeSession(directory, {
    id: 'localization-task', taskId: 'localization-task', work_id: 'localization-task', version: 3,
    title: 'Running',
    objective: 'Keep Overview Settings path unchanged',
    workspace: 'Settings',
    status: 'running', state: 'active', completionKnown: false,
    currentStage: 'Running', currentActivity: 'Working locally', summary: 'Working locally',
    semanticProgress: { currentStage: 'Running', currentActivity: 'Working locally' },
    startedAt: now - 60_000, startedAtIso: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(), lastActivityAt: now,
    calls: 0, toolCallCount: 0, progress: { mode: 'indeterminate', label: 'Running' },
    events: []
  });
  writeSession(directory, {
    id: 'localization-log-task', taskId: 'localization-log-task', work_id: 'localization-log-task', version: 3,
    title: 'Inspect raw command and log', objective: 'Keep command and log text unchanged', workspace: 'Settings',
    status: 'completed', state: 'ended', completionKnown: true,
    summary: 'LOG Overview Settings command',
    startedAt: now - 120_000, startedAtIso: new Date(now - 120_000).toISOString(),
    updatedAt: new Date(now - 2000).toISOString(), endedAt: new Date(now - 2000).toISOString(), completedAt: new Date(now - 2000).toISOString(), durationMs: 118_000,
    calls: 1, toolCallCount: 1, progress: { mode: 'determinate', completedUnits: 1, totalUnits: 1, percentage: 100, label: 'Complete' },
    events: [{
      eventId: 'localization-working', taskId: 'localization-log-task', timestamp: new Date(now - 1000).toISOString(),
      category: 'execution', action: 'check', status: 'succeeded', title: 'Working locally',
      summary: 'Working locally'
    }, {
      eventId: 'localization-event', taskId: 'localization-log-task', timestamp: new Date(now).toISOString(),
      category: 'validation', action: 'check', status: 'succeeded', title: 'npm run Overview Settings',
      command: 'npm run Overview Settings',
      summary: 'LOG Overview Settings command'
    }]
  });
}

function assertChinese(value, label) {
  assert.match(value, /[\u3400-\u9fff]/u, `${label} is not visibly Chinese: ${value}`);
}

async function waitForHealth(url) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP server did not become healthy: ${serverError}`);
}

async function waitForProbe(file, accept, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(file)) {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (accept(value)) return value;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Electron localization probe timed out after ${timeoutMs}ms`);
}
