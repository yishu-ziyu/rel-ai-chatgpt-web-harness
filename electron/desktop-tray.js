import { importResourceModule } from './resource-path.js';

const { t } = await importResourceModule('src/ui/i18n.js');

function createDesktopTray(deps) {
  const {
    Tray, Menu, nativeImage, clipboard, iconPath, getStatus,
    platform = process.platform,
    openDashboard, focusPrimaryWindow, openDiagnostics, openSettings,
    startServer, stopServer, getUpdateStatus = () => null,
    checkForUpdates, downloadUpdate, installUpdate,
    quit, onError = () => {}
  } = deps;
  let tray = null;

  function setup() {
    if (tray) return tray;
    const raw = nativeImage.createFromPath(iconPath);
    if (raw.isEmpty()) {
      onError(new Error(`Tray icon could not be loaded: ${iconPath}`));
      return null;
    }
    const image = raw.resize({ width: 32, height: 32 });
    if (image.isEmpty()) {
      onError(new Error(`Tray icon could not be prepared: ${iconPath}`));
      return null;
    }
    try {
      tray = new Tray(image);
      tray.setToolTip('Rel.AI MCP');
      tray.on(platform === 'linux' ? 'click' : 'double-click', focusPrimaryWindow);
      if (platform === 'win32') tray.on('balloon-click', focusPrimaryWindow);
      update();
      return tray;
    } catch (error) {
      tray?.destroy?.();
      tray = null;
      onError(error);
      return null;
    }
  }

  function update() {
    if (!tray) return false;
    const status = getStatus();
    const updateInstalling = getUpdateStatus()?.state === 'installing';
    const menu = Menu.buildFromTemplate([
      { label: status.serverRunning ? t('Rel.AI: running') : t('Rel.AI: stopped'), enabled: false },
      { label: t`Connection: ${tunnelStateLabel(status.tunnelStatus)}`, enabled: false },
      { type: 'separator' },
      { label: t('Open Dashboard'), click: () => void openDashboard().catch(onError) },
      {
        label: t('Copy local MCP address'),
        enabled: Boolean(status.localMcpUrl) && !updateInstalling,
        click: () => { if (status.localMcpUrl) clipboard.writeText(status.localMcpUrl); }
      },
      {
        label: status.serverRunning ? t('Stop Rel.AI') : t('Start Rel.AI'),
        enabled: !updateInstalling,
        click: () => status.serverRunning
          ? void Promise.resolve(stopServer()).catch(onError)
          : void startServer().catch(onError)
      },
      { type: 'separator' },
      updateMenuItem(),
      { label: t('Troubleshooting'), enabled: !updateInstalling, click: () => void openDiagnostics().catch(onError) },
      { label: t('Settings'), enabled: !updateInstalling, click: () => void openSettings().catch(onError) },
      { type: 'separator' },
      { label: t('Quit Rel.AI MCP'), enabled: !updateInstalling, click: quit }
    ]);
    tray.setContextMenu(menu);
    return true;
  }

  function updateMenuItem() {
    const status = getUpdateStatus() || {};
    const version = status.availableVersion ? ` v${status.availableVersion}` : '';
    if (status.state === 'checking') return { label: t('Checking for updates…'), enabled: false };
    if (status.state === 'downloading') return { label: t`Downloading update… ${Math.round(status.progress?.percent || 0)}%`, enabled: false };
    if (status.state === 'installing') return { label: t('Installing update…'), enabled: false };
    if (status.state === 'downloaded') {
      const label = status.installMode === 'open_dmg' ? t`Open update DMG${version}` : t`Install update${version}`;
      return { label, click: () => runUpdateAction(installUpdate) };
    }
    if (status.state === 'available') return { label: t`Download update${version}`, click: () => runUpdateAction(downloadUpdate) };
    if (status.state === 'unsupported') return { label: t('Updates require the installed app'), enabled: false };
    return { label: t('Check for updates'), click: () => runUpdateAction(checkForUpdates) };
  }

  function runUpdateAction(action) {
    if (typeof action !== 'function') return;
    Promise.resolve(action()).then(result => {
      if (result?.ok === false) return openSettings().catch(onError);
      update();
    }).catch(onError);
  }

  function showBalloon(content = {}) {
    if (platform !== 'win32' || !tray || typeof tray.displayBalloon !== 'function') return false;
    const title = String(content.title || '').trim();
    const body = String(content.body || '').trim();
    if (!title) return false;
    try {
      tray.displayBalloon({
        title,
        content: body,
        iconType: content.category === 'errors' ? 'error' : 'info',
        noSound: content.silent === true,
        respectQuietTime: true
      });
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function destroy() {
    if (!tray) return false;
    const current = tray;
    tray = null;
    try {
      current.destroy?.();
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  return { setup, update, showBalloon, destroy, isAvailable: () => Boolean(tray) };
}

function tunnelStateLabel(status) {
  switch (status) {
    case 'running': return t('Connected');
    case 'degraded': return t('Reconnecting');
    case 'authenticating': return t('Authenticating');
    case 'starting':
    case 'locally_ready':
    case 'connecting': return t('Connecting');
    case 'failed': return t('Failed');
    case 'stopped':
    case undefined: return t('Stopped');
    default: return status;
  }
}

export { createDesktopTray };
