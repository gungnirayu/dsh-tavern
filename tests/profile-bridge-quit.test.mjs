import test from 'node:test'
import assert from 'node:assert/strict'
import { requestDesktopQuit } from '../tavern-plugin/packages/dsh-profile-bridge/lib/quit.mjs'

test('Windows invokes only the identified desktop tray Quit helper, with bounded timeout', async () => {
  let invocation
  const result = await requestDesktopQuit({ pid: 123, executable: 'D:\\Apps\\DeepSeek Harness.exe', platform: 'win32' }, {
    run: (...args) => { invocation = args; args.at(-1)(null) },
    kill: () => assert.fail('Windows must not force-kill the desktop'),
  })
  assert.equal(result, true)
  assert.equal(invocation[0], 'powershell.exe')
  assert.deepEqual(invocation[1].slice(-4), ['-DesktopProcessId', '123', '-Executable', 'D:\\Apps\\DeepSeek Harness.exe'])
  assert.equal(invocation[2].windowsHide, true)
  assert.equal(invocation[2].timeout, 10000)
})

test('Unavailable Quit action falls back to manual quit without killing anything', async () => {
  assert.equal(await requestDesktopQuit({ pid: 123, executable: 'app.exe', platform: 'win32' }, {
    run: (...args) => args.at(-1)(new Error('menu unavailable')),
    kill: () => assert.fail('must preserve running work'),
  }), false)
  assert.equal(await requestDesktopQuit({ pid: 1, executable: 'app.exe' }, {
    run: () => assert.fail('invalid parent'),
  }), false)
})

test('macOS keeps the delayed graceful SIGTERM path', async () => {
  const calls = []
  assert.equal(await requestDesktopQuit({ pid: 123, executable: '/App/DSH', platform: 'darwin' }, {
    defer: (fn, ms) => { calls.push(ms); fn() }, kill: (...args) => calls.push(args),
  }), true)
  assert.deepEqual(calls, [500, [123, 'SIGTERM']])
})
