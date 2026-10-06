import common from './zh-CN/common.js';
import shell from './zh-CN/shell.js';
import work from './zh-CN/work.js';
import settings from './zh-CN/settings.js';
import desktop from './zh-CN/desktop.js';

const catalog = {};
for (const section of [common, shell, work, settings, desktop]) {
  for (const [key, value] of Object.entries(section)) {
    if (Object.hasOwn(catalog, key) && catalog[key] !== value) throw new Error(`Conflicting Chinese translation: ${key}`);
    catalog[key] = value;
  }
}
export default Object.freeze(catalog);
