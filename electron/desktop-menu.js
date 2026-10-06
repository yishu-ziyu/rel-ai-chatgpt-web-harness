import { importResourceModule } from './resource-path.js';

const { t } = await importResourceModule('src/ui/i18n.js');

function createLocalizedApplicationMenu({ Menu, platform = process.platform, appName = 'Rel.AI MCP' }) {
  const mac = platform === 'darwin';
  const template = [
    ...(mac ? [{
      label: appName,
      submenu: [
        { label: t`About ${appName}`, role: 'about' },
        { type: 'separator' },
        { label: t('Services'), role: 'services' },
        { type: 'separator' },
        { label: t`Hide ${appName}`, role: 'hide' },
        { label: t('Hide Others'), role: 'hideOthers' },
        { label: t('Show All'), role: 'unhide' },
        { type: 'separator' },
        { label: t`Quit ${appName}`, role: 'quit' }
      ]
    }] : [{ label: t('File'), submenu: [{ label: t('Close'), role: 'close' }, { label: t('Quit'), role: 'quit' }] }]),
    {
      label: t('Edit'),
      submenu: [
        { label: t('Undo'), role: 'undo' },
        { label: t('Redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('Cut'), role: 'cut' },
        { label: t('Copy'), role: 'copy' },
        { label: t('Paste'), role: 'paste' },
        { label: t('Select All'), role: 'selectAll' }
      ]
    },
    {
      label: t('View'),
      submenu: [
        { label: t('Reload'), role: 'reload' },
        { label: t('Force Reload'), role: 'forceReload' },
        { label: t('Toggle Developer Tools'), role: 'toggleDevTools' },
        { type: 'separator' },
        { label: t('Actual Size'), role: 'resetZoom' },
        { label: t('Zoom In'), role: 'zoomIn' },
        { label: t('Zoom Out'), role: 'zoomOut' },
        { type: 'separator' },
        { label: t('Toggle Full Screen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: t('Window'),
      submenu: [
        { label: t('Minimize'), role: 'minimize' },
        { label: t('Close'), role: 'close' },
        ...(mac ? [{ label: t('Bring All to Front'), role: 'front' }] : [])
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

export { createLocalizedApplicationMenu };
