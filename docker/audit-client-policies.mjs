import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Explicitly reviewed active loopback facts/gates. New client-side policies require review.
const approved = new Map([
  ['dsh-mnemon/lib/client.js', [
    'const DEFAULT_EMBEDDING_ENDPOINT = "http://localhost:11434";',
    'function isLoopbackHostname(hostname) {',
    'if (hostname === "localhost" || hostname === "[::1]") return true;',
    'const hostname = globalThis.location?.hostname;',
    'return typeof hostname === "string" && hostname !== "" && !isLoopbackHostname(hostname) || connection.isLoopback === false;',
    'embeddingEndpoint: resolved.embedding?.endpoint?.trim() || "http://localhost:11434",',
  ]],
  ['dsh-api-gateway/lib/client.js', ['isLoopback: this.connection.isLoopback']],
  ['dsh-client-connection/lib/client.js', ['function isLoopbackHostname(hostname) {', 'if (hostname === "localhost" || hostname === "[::1]") return true;', 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),']],
  // This hides "open server settings.yaml in a native editor", not browser settings reads/writes.
  ['dsh-client-ui-settings-general/lib/client.js', ['const documentController = ctx.remote.$host.isLoopback ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe()) : void 0;']],
]);
let clients = 0, dependencies = 0, gates = 0;
const failures = [];
function walk(directory) {
  let entries;
  try { entries = readdirSync(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && entry.name === 'client.js' && /\/node_modules\/(?:@[^/]+\/)?[^/]+\/lib\/client\.js$/.test(file)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('window.__ModuleLoader__.load(')) continue;
      const fullKey = file.split('/node_modules/').at(-1);
      const key = fullKey.startsWith('@deepseek-ai/') ? fullKey.slice('@deepseek-ai/'.length) : fullKey;
      if (fullKey.startsWith('@deepseek-ai/')) clients++; else dependencies++;
      source.split('\n').forEach((line, index) => {
        const code = line.trim();
        if (!/\bisLoopback\b|\bisLoopbackHostname\b|\bisSecureContext\b|localhost|127\.0\.0\.1|location\??\.hostname/.test(code)) return;
        if (/^(?:\/\/|\/\*|\*|declaration:)/.test(code)) return;
        // Reviewed display-only endpoint examples, not an address policy.
        if (['dsh-mnemon/lib/client.js', 'dsh-mnemon-source-memory-spaces/lib/client.js'].includes(key) && code.startsWith('"overview.providerEndpointPlaceholder":')) return;
        gates++;
        if (!approved.get(key)?.includes(code)) failures.push(`${key}:${index+1}: ${code.slice(0, 220)}`);
      });
      if (key === 'dsh-client-ui-settings/lib/client.js' && !source.includes('DSH_DOCKER_AUTHENTICATED_SETTINGS')) failures.push('Settings adaptation missing');
      if (key === 'dsh-client-modules/lib/client.js' && !source.includes('DSH_DOCKER_BROWSER_COMPAT')) failures.push('Browser compatibility bootstrap missing');
    }
  }
}
let tavernClients = 0;
const sidebarPolicies = new Set([
  'function isLoopbackHostname(hostname) {',
  'if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;',
  'if (!isLoopbackHostname(parsed.hostname)) return false;',
  'if (isLoopbackHostname(url.hostname)) {',
]);
function walkTavern(directory, relative = '') {
  let entries;
  try { entries = readdirSync(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name), key = relative + entry.name;
    if (entry.isDirectory() && !['vendor', 'node_modules'].includes(entry.name)) walkTavern(file, key + '/');
    else if (entry.isFile() && /^client(?:-[^/]*)?\.js$/.test(entry.name)) {
      tavernClients++;
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const code = line.trim();
        if (!/\bisLoopback\b|\bisLoopbackHostname\b|\bisSecureContext\b|localhost|127\.0\.0\.1|location\??\.hostname/.test(code)) return;
        if (/^(?:\/\/|\/\*|\*|declaration:|settingsBrowserLoopbackDesc:|settingsBrowserLoopbackPlaceholder:)/.test(code)) return;
        if (key.startsWith('packages/dsh-better-sidebar/lib/') && sidebarPolicies.has(code)) return;
        if (key === 'packages/dsh-dream-skin/lib/client.js' && code === 'const HOST_API = new URL("dream-skin/api", document.baseURI || "http://localhost/").pathname;') return;
        // User-configurable backend default, not a browser/server bind or GUI permission gate.
        if (key === 'packages/dsh-image-gen/lib/client.js' && code === 'const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";') return;
        failures.push(`tavern-plugin/${key}:${index+1}: ${code.slice(0, 220)}`);
      });
    }
  }
}
const root = process.argv[2] || '/data';
for (const directory of ['apps', 'runtime', 'profiles']) walk(path.join(root, directory));
walkTavern(path.join(root, 'apps/dsh-tavern/tavern-plugin'));
if (!clients) throw new Error('No installed DSH browser clients found for audit');
if (failures.length) throw new Error(`Unreviewed browser address/security policy:\n${failures.join('\n')}`);
console.log(`PASS: address-policy audit (${clients} DSH clients, ${tavernClients} Tavern clients, ${dependencies} installed dependency clients, ${gates} reviewed facts/defaults/routes)`);
