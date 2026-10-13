import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Explicitly reviewed active loopback facts/gates. New client-side policies require review.
const approved = new Map([
  ['dsh-api-gateway/lib/client.js', ['isLoopback: this.connection.isLoopback']],
  ['dsh-client-connection/lib/client.js', ['function isLoopbackHostname(hostname) {', 'if (hostname === "localhost" || hostname === "[::1]") return true;', 'isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),']],
  // This hides "open server settings.yaml in a native editor", not browser settings reads/writes.
  ['dsh-client-ui-settings-general/lib/client.js', ['const documentController = ctx.remote.$host.isLoopback ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe()) : void 0;']],
]);
let clients = 0, gates = 0;
const failures = [];
function walk(directory) {
  let entries;
  try { entries = readdirSync(directory, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && entry.name === 'client.js' && /\/node_modules\/@deepseek-ai\/[^/]+\/lib\/client\.js$/.test(file)) {
      clients++;
      const key = file.split('/@deepseek-ai/').at(-1);
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        const code = line.trim();
        if (!/\bisLoopback\b|\bisLoopbackHostname\b|\bisSecureContext\b|localhost|127\.0\.0\.1|location\??\.hostname/.test(code)) return;
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('declaration:')) return;
        gates++;
        if (!approved.get(key)?.includes(code)) failures.push(`${key}:${index+1}: ${code.slice(0, 220)}`);
      });
      if (key === 'dsh-client-ui-settings/lib/client.js' && !source.includes('DSH_DOCKER_AUTHENTICATED_SETTINGS')) failures.push('Settings adaptation missing');
      if (key === 'dsh-client-modules/lib/client.js' && !source.includes('DSH_DOCKER_BROWSER_COMPAT')) failures.push('Browser compatibility bootstrap missing');
    }
  }
}
const root = process.argv[2] || '/data';
for (const directory of ['apps', 'runtime', 'profiles']) walk(path.join(root, directory));
if (!clients) throw new Error('No installed DSH browser clients found for audit');
if (failures.length) throw new Error(`Unreviewed browser address/security policy:\n${failures.join('\n')}`);
console.log(`PASS: address-policy audit (${clients} client files, ${gates} reviewed facts/native-only gates)`);
