/**
 * dsh-profile-bridge — browser half.
 *
 * Adds one settings page that shows which profile this Harness is running, which
 * other profiles exist, and switches the app's profile directory to the one you
 * pick (or reverts that switch). All file work happens in the Host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-profile-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared RPC channel owned by this plugin's Host half. */
    const CHANNEL = '/profile-bridge'
    /** Locale namespace of this page. */
    const NS = 'profileBridge'

    const zh = {
      section: 'Profile 切换',
      title: 'Profile 切换',
      subtitle: '选择桌面版使用哪套配置。',
      original: '原版 DSH',
      originalHint: '桌面版自带的配置',
      tavern: 'DSH Tavern',
      tavernHint: '装好了酒馆插件的配置',
      pending: '重启后生效',
      restartHint: '重启桌面版后生效。',
      restart: '立即重启',
      restarting: '正在重启…',
      quitHint: '请从托盘退出桌面版，切换完成后会自动重新打开（两分钟内有效）。',
      confirm: '确定',
      loading: '读取中…',
      noModules: '缺少 node_modules，插件尚未安装',
      cliHint: '当前不是桌面版。命令行用户直接用 dsh --profile <名称> 选择即可。',
      failure: '操作失败',
      more: '说明与日志',
      logEmpty: '（还没有日志）',
      why: '桌面版固定读取 profiles/desktop。选择其他配置时，会把它链接到所选配置（Windows 用 junction，macOS/Linux 用符号链接）；原版配置先备份，随时可以选回。更换需要桌面版先退出：重启走正常退出流程，有任务时会先请你确认，不会强制结束进程。',
    }
    const en = {
      section: 'Profile switch',
      title: 'Profile switch',
      subtitle: 'Choose which setup the Desktop app uses.',
      original: 'Original DSH',
      originalHint: 'The setup Desktop ships with',
      tavern: 'DSH Tavern',
      tavernHint: 'The setup with the Tavern plugins installed',
      pending: 'After restart',
      restartHint: 'Takes effect after Desktop restarts.',
      restart: 'Restart now',
      restarting: 'Restarting…',
      quitHint: 'Quit Desktop from the tray; it reopens by itself after the switch (valid for two minutes).',
      confirm: 'OK',
      loading: 'Loading…',
      noModules: 'node_modules missing; plugins are not installed yet',
      cliHint: 'This is not the Desktop app. Command-line users can pick one with dsh --profile <name>.',
      failure: 'Failed',
      more: 'Details and log',
      logEmpty: '(no log yet)',
      why: 'Desktop always reads profiles/desktop. Choosing another setup links it there (a junction on Windows, a symlink elsewhere); the original is backed up first and you can choose it again any time. Desktop has to exit first: restarting is a normal quit that asks for confirmation when tasks are running, never a forced kill.',
    }

    /** Scoped stylesheet; class names are prefixed so they never leak into the host. */
    const CSS = `
.pb { display: grid; gap: 16px; font-size: 13px; line-height: 1.6; color: inherit; width: 100%; max-width: 640px; min-width: 0;
  --pb-accent: #4d6bfe; --pb-accent-soft: rgba(77,107,254,0.07); --pb-line: rgba(127,127,127,0.25); --pb-fill: rgba(127,127,127,0.06); }
.pb * { box-sizing: border-box; }
.pb-head { display: grid; gap: 2px; }
.pb-title { margin: 0; font-size: 16px; font-weight: 600; }
.pb-sub { margin: 0; opacity: 0.6; }
.pb-list { display: grid; gap: 10px; }
.pb-option { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border: 1px solid var(--pb-line); border-radius: 12px; cursor: pointer; transition: border-color .15s, background .15s; }
.pb-option:hover:not(:disabled) { border-color: rgba(127,127,127,0.5); }
.pb-option:focus-visible { outline: 2px solid var(--pb-accent); outline-offset: 2px; }
.pb-option:disabled { cursor: default; }
.pb-option.is-on { border-color: var(--pb-accent); background: var(--pb-accent-soft); }
.pb-dot { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(127,127,127,0.55); display: grid; place-items: center; }
.pb-option.is-on .pb-dot { border-color: var(--pb-accent); }
.pb-option.is-on .pb-dot::after { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--pb-accent); }
.pb-info { flex: 1; min-width: 0; display: grid; }
.pb-name { font-size: 14px; font-weight: 500; }
.pb-hint { font-size: 12px; opacity: 0.55; }
.pb-bad { color: #e5484d; opacity: 1; }
.pb-tag { flex: none; font-size: 12px; color: var(--pb-accent); }
.pb-bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; background: var(--pb-accent-soft); }
.pb-bar-text { flex: 1; min-width: 0; }
.pb-btn { appearance: none; font: inherit; font-size: 13px; flex: none; color: #fff; background: var(--pb-accent); border: 0; border-radius: 8px; padding: 6px 16px; cursor: pointer; }
.pb-btn:hover:not(:disabled) { background: #3d5bf0; }
.pb-btn:disabled { opacity: 0.5; cursor: default; }
.pb-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.pb-fold summary { list-style: none; cursor: pointer; opacity: 0.55; font-size: 12px; user-select: none; }
.pb-fold summary::-webkit-details-marker { display: none; }
.pb-fold summary::before { content: '›'; display: inline-block; width: 12px; transition: transform .15s; }
.pb-fold[open] summary::before { transform: rotate(90deg); }
.pb-fold summary:hover { opacity: 1; }
.pb-fold p { margin: 6px 0; opacity: 0.6; font-size: 12px; }
.pb-pre { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--pb-fill); max-height: 200px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
`

    /** Describe one RPC failure for display. */
    function describeFailure(error) {
      if (error === undefined || error === null) return 'unknown error'
      return typeof error.message === 'string' ? error.message : String(error)
    }

    /** Key of the option for Desktop's own (unlinked) profile. */
    const ORIGINAL = ''

    /**
     * One settings page: the setups Desktop can run as a single-choice list. The
     * one in use is selected; picking another offers a restart, which queues the
     * link (or, for Desktop's own profile, the revert) and quits and reopens the app.
     * @param {{ t: Function, rpcCall: Function }} props - injected faces from the registration.
     */
    function ProfileBridgeSettings(props) {
      const t = props.t
      const call = props.rpcCall
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [failure, setFailure] = React.useState(null)
      // The option the user picked (not yet applied), and the receipt once the switch is queued.
      const [picked, setPicked] = React.useState(null)
      const [applied, setApplied] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const result = await call('status', {})
          if (result?.ok === true) setStatus(result.value)
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setLoading(false)
        }
      }, [call])

      React.useEffect(() => {
        void load()
      }, [load])

      const apply = React.useCallback(async () => {
        if (picked === null) return
        setBusy(true)
        setFailure(null)
        try {
          const result = picked === ORIGINAL
            ? await call('unlink', {})
            : await call('link', { target: picked })
          if (result?.ok === true) setApplied(result.value ?? {})
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ code: 'transport', message: error?.message ?? String(error) }))
        } finally {
          setBusy(false)
        }
      }, [call, picked])

      const isDesktop = status?.appKind === 'desktop'
      const linked = status?.activeIsLink === true
      const currentKey = linked ? status?.linkTargetName : ORIGINAL
      const chosenKey = picked !== null ? picked : currentKey
      const canQuit = status?.platform !== 'win32'
      // Desktop's own profile can only be chosen again while its backup still exists.
      const canRevert = !linked || (status?.backups ?? []).length > 0
      const options = status === null ? [] : [
        ...(canRevert ? [{ key: ORIGINAL, label: t('original'), hint: t('originalHint') }] : []),
        ...(status.profiles ?? [])
          // Only profiles that also carry this page: from any other the app has no way back.
          .filter((profile) => profile.name !== status.activeName && (profile.bundles ?? []).includes('dsh-profile-bridge'))
          .map((profile) => ({
            key: profile.name,
            label: profile.name === 'tavern' ? t('tavern') : profile.name,
            hint: profile.name === 'tavern' ? t('tavernHint') : profile.dir,
            bad: profile.hasNodeModules ? null : t('noModules'),
          })),
      ]

      return h('section', { className: 'pb' },
        h('style', null, CSS),
        h('header', { className: 'pb-head' },
          h('h2', { className: 'pb-title' }, t('title')),
          h('p', { className: 'pb-sub' }, isDesktop || status === null ? t('subtitle') : t('cliHint')),
        ),

        status === null
          ? h('p', { className: 'pb-sub' }, loading ? t('loading') : '')
          : !isDesktop ? null : h('div', { className: 'pb-list', role: 'radiogroup', 'aria-label': t('title') },
              options.map((option) => {
                const on = option.key === chosenKey
                return h('button', {
                  key: option.key || '(original)',
                  type: 'button',
                  role: 'radio',
                  'aria-checked': on,
                  className: on ? 'pb-option is-on' : 'pb-option',
                  disabled: busy || applied !== null,
                  onClick: () => setPicked(option.key === currentKey ? null : option.key),
                },
                  h('span', { className: 'pb-dot' }),
                  h('span', { className: 'pb-info' },
                    h('span', { className: 'pb-name' }, option.label),
                    h('span', { className: option.bad ? 'pb-hint pb-bad' : 'pb-hint' }, option.bad ?? option.hint),
                  ),
                  on && picked !== null ? h('span', { className: 'pb-tag' }, t('pending')) : null,
                )
              }),
            ),

        picked === null ? null : h('div', { className: 'pb-bar' },
          h('span', { className: 'pb-bar-text' },
            applied === null ? t('restartHint') : applied.closesApp ? t('restarting') : t('quitHint'),
            ...(applied?.warnings ?? []).map((warning) => h('span', { key: warning, style: { display: 'block', opacity: 0.75 } }, `• ${warning}`)),
          ),
          applied !== null ? null : h('button', {
            type: 'button',
            className: 'pb-btn',
            disabled: busy,
            onClick: () => void apply(),
          }, busy ? t('restarting') : canQuit ? t('restart') : t('confirm')),
        ),

        failure !== null ? h('p', { className: 'pb-error' }, `${t('failure')}: ${failure}`) : null,

        h('details', { className: 'pb-fold' },
          h('summary', null, t('more')),
          h('p', null, t('why')),
          // The structured log is empty when the helper never reached its first
          // line (for example a PowerShell startup failure); the launcher
          // transcript is where that shows up.
          h('pre', { className: 'pb-pre' },
            status?.logTail?.trim()
              ? status.logTail
              : status?.transcriptTail?.trim() ? status.transcriptTail : t('logEmpty')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        const rpcCall = (endpoint, payload) => ctx.connection.rpc.call(CHANNEL, endpoint, payload)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'profile-bridge: locale dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'profile-bridge',
          order: 60,
          label: () => t('section'),
          inject: () => ({ rpcCall, t }),
        }, ProfileBridgeSettings))
      },
    }
  },
})
