import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The host keeps earlier generations of a session log next to the current one
// (session.jsonl.zstd, session.v3.jsonl.zstd, session.v4.jsonl.zstd, …). Read the newest,
// whatever the current format is, instead of naming one version.
const LOG = /^session(?:\.v(\d+))?\.jsonl\.zstd$/
export const sessionLogGeneration = name => { const match = LOG.exec(name); return match ? Number(match[1] || 0) : -1 }

/** The current log of every session directory under `root`: { path, directory, generation }. */
export async function currentSessionLogs(root) {
  const newest = new Map()
  for (const relative of await readdir(root, { recursive: true })) {
    const generation = sessionLogGeneration(relative.split(/[\\/]/).at(-1))
    if (generation < 0) continue
    const directory = dirname(relative), held = newest.get(directory)
    if (!held || generation > held.generation) newest.set(directory, { path: join(root, relative), directory: join(root, directory), generation })
  }
  return [...newest.values()]
}

/** Remove every generation of the log in `directory` except `keep` (a file name). */
export async function dropOtherGenerations(directory, keep) {
  for (const name of await readdir(directory)) if (sessionLogGeneration(name) >= 0 && name !== keep) await rm(join(directory, name), { force: true })
}
