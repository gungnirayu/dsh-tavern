#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
const origin = process.env.DSH_TAVERN_PUBLIC_URL;
if (!origin) throw new Error('DSH_TAVERN_PUBLIC_URL is required');
const command = process.argv[2] || 'status';
if (!['status', 'start'].includes(command)) throw new Error('Usage: tavern-url [status|start]');
try {
  const output = execFileSync(process.execPath, ['/data/apps/dsh-tavern/bin/dsh-tavern.mjs', command], {encoding: 'utf8', maxBuffer: 10 * 1024 * 1024});
  const internal = `http://127.0.0.1:${process.env.DSH_TAVERN_PORT || 3081}`;
  process.stdout.write(output.replaceAll(internal + '/', new URL(origin).origin + '/'));
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  process.exit(error.status || 1);
}
