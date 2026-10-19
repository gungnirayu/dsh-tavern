// The official CLI reserves "desktop" for Electron; use the host's own profile
// loader to validate installation without starting a second server or UI.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { installedProfile } from './launcher-environment.mjs'
const anchor = process.env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR
if (!anchor || !process.env.DSH_HOME) throw new Error('缺少官方 Desktop 运行环境')
const require = createRequire(anchor)
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const original = Boolean(process.argv[2])
const profile = boot.loadProfileDirectory('dsh-tavern', process.argv[2] || path.join(process.env.DSH_HOME, 'profiles', installedProfile('desktop', process.env.DSH_HOME)), anchor)
// The original desktop profile may come from the other desktop app sharing ~/.dsh (official DeepSeek
// Harness vs community DSH NEXT): bundles that app ships (e.g. @agents-anywhere/dsh-bridge-next)
// cannot resolve here and DSH skips them at runtime too. Only Tavern's own bundles must load.
const ours = new Set(['dsh-profile-bridge', 'dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-dream-skin'])
const fatal = original ? profile.skippedBundles.filter(item => ours.has(item.packageName)) : profile.skippedBundles
for (const item of profile.skippedBundles.filter(item => !fatal.includes(item))) console.log(`原版配置里的 ${item.packageName} 由另一个桌面应用提供，当前桌面加载时会跳过，不影响切换回原版。`)
if (fatal.length) throw new Error(fatal.map(item => `${item.packageName}: ${item.reason}`).join('\n'))
const homePatch = boot.loadOptionalPatches('dsh-tavern', path.join(process.env.DSH_HOME, 'cordis.patch.yml')) || []
const entries = boot.composeEntries([...profile.layers.map(layer => layer.patches), profile.patches, homePatch], message => console.error(message))
if (!profile.layers.some(layer => layer.packageName === (original ? 'dsh-profile-bridge' : 'dsh-tavern-plugin'))) throw new Error('Desktop 配置没有加载酒馆插件')
console.log(`桌面版配置验证通过：${profile.layers.length} 个插件包，${entries.length} 个配置条目`)
