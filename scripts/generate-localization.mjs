import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../src/ui/locales/zh-CN.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = fs.readFileSync(path.join(root, 'src/ui/i18n.js'), 'utf8')
  .replace("'./locales/zh-CN.js'", "'./zh-CN.js'");
const generated = {
  'i18n.js': `// Generated from src/ui/i18n.js. Do not edit by hand.\n${helper}`,
  'zh-CN.js': `// Generated from src/ui/locales/zh-CN/. Do not edit by hand.\nexport default ${JSON.stringify(catalog, null, 2)};\n`
};
for (const [name, content] of Object.entries(generated)) {
  const target = path.join(root, 'electron/renderer', name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      throw new Error(`Generated localization is stale: ${name}. Run node scripts/generate-localization.mjs.`);
    }
  } else fs.writeFileSync(target, content);
}
