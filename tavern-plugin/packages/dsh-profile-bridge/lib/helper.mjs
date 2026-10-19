// Tavern compatibility fork of 2NF/dsh-profile-bridge (MIT).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, lstatSync, renameSync, symlinkSync, unlinkSync, readFileSync, readdirSync, realpathSync, statSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A lock older than this without a live helper is safe to reclaim. */
const PENDING_STALE_MS = 3 * 60 * 1000
/** How many reclaimed lock directories to keep for diagnosis. */
const STALE_LIMIT = 5

function manifest(dir) {
  const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!Array.isArray(doc?.dsh?.profile?.bundles)) throw new Error('目标 profile 缺少有效的 bundle 列表')
}
const present = path => { try { lstatSync(path); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }

// The caller must own the operation lock and have waited for Desktop and its Host to exit.
export function switchProfile({ mode, profilesRoot, liveDir, targetDir, stamp }, { rename = renameSync, link = symlinkSync } = {}) {
  const root = realpathSync(profilesRoot)
  if (resolve(liveDir) !== join(resolve(profilesRoot), 'desktop')) throw new Error('只允许切换 desktop 入口')
  const linked = present(liveDir) && lstatSync(liveDir).isSymbolicLink()
  let destination
  if (mode === 'link') {
    destination = realpathSync(targetDir)
    if (dirname(destination) !== root || destination === join(root, 'desktop') || /\.fresh-|\.switch-/.test(destination.slice(root.length))) throw new Error('目标必须是 profiles 下的独立 profile')
    manifest(destination)
    if (present(liveDir) && realpathSync(liveDir) === destination) return { changed: false }
  } else if (mode === 'unlink') {
    if (!linked) throw new Error('desktop 不是链接，无需还原')
    destination = readdirSync(profilesRoot).filter(name => name.startsWith('desktop.fresh-')).sort().reverse()
      .map(name => join(profilesRoot, name)).find(dir => { try { return lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() && (manifest(dir), true) } catch { return false } })
    if (!destination) throw new Error('找不到可用的原版 desktop 备份，未修改目录')
  } else throw new Error('未知切换操作')
  if (!present(liveDir)) throw new Error('desktop 入口不存在，未执行切换')
  const previous = join(profilesRoot, linked ? `desktop.switch-${stamp}` : `desktop.fresh-${stamp}`)
  const staged = join(profilesRoot, `desktop.switch-stage-${stamp}`)
  if (present(previous) || present(staged)) throw new Error('备份路径已存在')
  if (mode === 'link') link(destination, staged, process.platform === 'win32' ? 'junction' : 'dir')
  let moved = false
  try {
    rename(liveDir, previous)
    moved = true
    rename(mode === 'link' ? staged : destination, liveDir)
  } catch (error) {
    if (moved) {
      try { rename(previous, liveDir) } catch (rollback) { throw new Error(`切换失败且自动恢复失败；原入口保存在 ${previous}：${rollback.message}`, { cause: error }) }
    }
    throw error
  } finally {
    if (present(staged) && lstatSync(staged).isSymbolicLink()) unlinkSync(staged)
  }
  if (linked) unlinkSync(previous) // remove only the saved link, never its target
  return { changed: true, target: realpathSync(liveDir), backup: linked ? undefined : previous }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' }
}
export async function waitForExit(pids, { timeout = 120000, alive = processAlive, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeout
  while (pids.some(alive)) {
    if (Date.now() >= deadline) throw new Error('等待桌面退出超时，未修改 profile；请正常退出后重试')
    await delay(250)
  }
}

/**
 * Command that reopens Desktop once it has exited.
 * @param {string} exe - the running application binary.
 * @param {string} platform - process.platform.
 * @returns {[string, string[]]} command and arguments.
 */
export function relaunchCommand(exe, platform = process.platform) {
  // On macOS the binary sits inside the .app bundle; open the bundle so Launch Services owns it.
  const bundle = platform === 'darwin' ? /^(.*?\.app)(?:\/|$)/u.exec(exe)?.[1] : undefined
  return bundle === undefined ? [exe, []] : ['open', [bundle]]
}

/**
 * Reopen Desktop detached from the helper.
 * @param {string} exe - the running application binary.
 */
export function relaunchApp(exe) {
  const [command, args] = relaunchCommand(exe)
  // The helper itself runs the app binary as node; the reopened app must not.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(command, args, { detached: true, stdio: 'ignore', env }).unref()
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}

function pendingIsStale(lock, alive, now) {
  const worker = readJson(join(lock, 'worker.json'))
  const pid = worker?.pid
  if (Number.isInteger(pid) && pid > 1) return !alive(pid)
  // Locks written by older versions carry no worker pid. Keep them while the
  // app they were waiting for is still running; otherwise only age can tell.
  const request = readJson(join(lock, 'request.json'))
  if (Array.isArray(request?.pids) && request.pids.some(candidate => alive(candidate))) return false
  const startedAt = Number.isFinite(worker?.startedAt) ? worker.startedAt : (() => {
    try { return statSync(lock).mtimeMs } catch { return 0 }
  })()
  return now() - startedAt > PENDING_STALE_MS
}

function pruneStale(staleRoot, keep) {
  try {
    const entries = readdirSync(staleRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('pending-'))
      .map(entry => {
        try { return { name: entry.name, at: statSync(join(staleRoot, entry.name)).mtimeMs } } catch { return undefined }
      })
      .filter(Boolean)
      .sort((left, right) => right.at - left.at)
    for (const entry of entries.slice(keep)) {
      try { rmSync(join(staleRoot, entry.name), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

function archiveStale(lock, stateDir, now, keep) {
  const staleRoot = join(stateDir, 'stale')
  mkdirSync(staleRoot, { recursive: true })
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
  const target = join(staleRoot, `pending-${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`)
  renameSync(lock, target)
  pruneStale(staleRoot, keep)
  return target
}

function busyError(lock, detail = '') {
  const suffix = detail === '' ? '' : `；${detail}`
  return Object.assign(new Error(`已有一个切换在等待桌面退出（最长两分钟），请稍后再试${suffix}；若桌面已退出且超过三分钟，重试时系统会自动清理陈旧记录（${lock}）。`), { code: 'busy' })
}

/**
 * Claim the single pending slot, archiving a lock whose helper is gone.
 * @param {string} stateDir - profile-bridge state directory.
 * @param {{ alive?: Function, now?: Function, keep?: number }} [options] - test seams.
 * @returns {{ lock: string, reclaimed: boolean }} claimed lock and whether an old one was archived.
 */
export function acquirePendingLock(stateDir, { alive = processAlive, now = Date.now, keep = STALE_LIMIT } = {}) {
  mkdirSync(stateDir, { recursive: true })
  const lock = join(stateDir, 'pending')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lock)
      return { lock, reclaimed: attempt > 0 }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (attempt === 0 && pendingIsStale(lock, alive, now)) {
        try {
          archiveStale(lock, stateDir, now, keep)
        } catch (archiveError) {
          if (archiveError.code === 'ENOENT') continue
          throw busyError(lock, `陈旧记录无法自动归档：${archiveError.message}`)
        }
        continue
      }
      throw busyError(lock)
    }
  }
  throw busyError(lock)
}

// Lock is acquired before responding, so repeated clicks cannot schedule competing switches.
export function scheduleSwitch(request, options = {}) {
  const { lock, reclaimed } = acquirePendingLock(request.stateDir, options)
  const job = join(lock, 'request.json')
  const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
  try {
    writeFileSync(job, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
    const child = spawn(process.execPath, [worker, job], { detached: true, stdio: 'ignore', cwd: request.stateDir, env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } })
    if (Number.isInteger(child.pid) && child.pid > 1) {
      try { writeFileSync(join(lock, 'worker.json'), JSON.stringify({ pid: child.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 }) } catch {}
    }
    child.on('error', () => { /* request stays on disk for diagnosis; no profile was changed */ })
    child.unref()
    return { pid: child.pid, logPath: join(request.stateDir, 'last-run.log'), reclaimed }
  } catch (error) {
    throw new Error(`无法启动切换助手，待处理记录位于 ${lock}：${error.message}`)
  }
}
