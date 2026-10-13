import { readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const original = 'const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";';
const adapted = 'const persistence = "host"; // DSH_DOCKER_AUTHENTICATED_SETTINGS';
export function adaptSettingsClient(root) {
  let found = 0, bootstrap = 0;
  const compat = readFileSync(new URL('./browser-compat.js', import.meta.url), 'utf8');
  function walk(directory) {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && target.endsWith('/dsh-client-modules/lib/client.js')) {
        const source = readFileSync(target, 'utf8');
        if (!source.includes('DSH_DOCKER_BROWSER_COMPAT')) {
          if (!source.includes('window.__ModuleLoader__.load(')) throw new Error(`Client bootstrap changed; review Docker adapter: ${target}`);
          const temporary = `${target}.docker-${process.pid}`;
          writeFileSync(temporary, compat + '\n' + source);
          renameSync(temporary, target);
        }
        bootstrap++;
      }
      else if (entry.isFile() && target.endsWith('/dsh-client-ui-settings/lib/client.js')) {
        const source = readFileSync(target, 'utf8');
        if (source.includes(adapted)) { found++; continue; }
        if (source.split(original).length !== 2) throw new Error(`Settings client changed; review Docker adapter: ${target}`);
        // Replace atomically, breaking pnpm store hardlinks rather than editing the store.
        const temporary = `${target}.docker-${process.pid}`;
        writeFileSync(temporary, source.replace(original, adapted));
        renameSync(temporary, target);
        found++;
      }
    }
  }
  for (const entry of ['apps', 'runtime', 'profiles']) walk(path.join(root, entry));
  if (!found || !bootstrap) throw new Error('No supported DSH settings client/bootstrap found');
  return found;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Docker settings adapter: ${adaptSettingsClient(process.argv[2] || '/data')} client(s)`);
}
