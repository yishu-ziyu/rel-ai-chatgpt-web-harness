# 简体中文界面

本分支以官方 `1.1.3` 为基线，保留应用名、Bundle ID 和原有数据目录。语言选择位于「设置 → 偏好设置 → 语言」，支持跟随系统、简体中文和 English。桌面应用将选择保存在 `desktop-lifecycle.json`；普通浏览器仪表盘按浏览器保存。

界面文案使用 `src/ui/i18n.js`，React 视图通过 `useUiLanguage()` 订阅切换。词典位于 `src/ui/locales/zh-CN/`。只翻译明确属于应用的文案；项目名、路径、任务说明、命令、日志、API 字段和技术标识保持原文。动态消息使用带参数的 `t` 模板，参数保持原值，禁止把整段用户内容传给词典。

原生向导、恢复页和 Pulse 使用同源词典生成的平面模块。运行 `npm run build:frontend` 会重新生成 `electron/renderer/i18n.js`、`electron/renderer/zh-CN.js` 和前端资源；不要手改生成文件。`npm run verify:generated` 检查资源与源码一致性，macOS 打包脚本也会生成原生词典。

使用仓库声明的 Node 版本。中文端到端检查为 `node test/localization-browser.mjs`，运行在临时配置、独立端口和临时 Electron 用户目录；可用 `RELAI_LOCALIZATION_OUTPUT_DIR` 指定截图与结果目录。检查覆盖中英切换、刷新保存、原文恰好与翻译键相同的项目和任务、命令与日志保留，以及正常与窄窗口布局。正式应用的重启保存、现有 ChatGPT 隧道和云端请求需要另做安装后的验收。

本地构建不等于已发布的 GitHub 版本。原上游发布页仍提供英文官方版本；升级上游后需合并源码、重新构建并重新验收汉化。
