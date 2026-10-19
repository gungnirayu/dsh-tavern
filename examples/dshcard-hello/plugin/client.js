// 最小卡内插件（浏览器侧）：用 registerStageView 画自己的舞台。
// 底色按宿主侧记下的氛围变，人物用 Tavern 的「角色素材」（导入卡时从 card.json 的 assets 带进来），
// 翻页、朗读、全屏这些阅读流程仍由 Tavern 负责，插件只画场景，把 footer 放进自己的对白框。
window.__ModuleLoader__.load({
  id: 'dsh-card-hello-mood',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const COLORS = { warm: ['#5a3418', '#c9853f'], calm: ['#29404a', '#7fa3a8'], tense: ['#3a1414', '#a8442f'], night: ['#0f1530', '#3b4a86'] }

    function useMood(ui, gameId, turn) {
      const [mood, setMood] = React.useState('warm')
      const [version, setVersion] = React.useState(0)
      // 新一轮结算完、玩家改了本局设置，都重新问一次。
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => ui.watchGameSettings(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        ui.callHost('dshcard-hello/mood', { gameId, turn: turn || 0 }).then(reply => { if (active) setMood(reply.mood) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return mood
    }

    function Stage({ ui, gameId, stage, beat, fullscreen, advance, footer }) {
      const mood = useMood(ui, gameId, beat && beat.turn)
      const [dark, light] = COLORS[mood] || COLORS.warm
      const who = beat && beat.kind === 'line' ? stage.characters.find(c => c.name === beat.speaker) : stage.characters[0]
      const picture = who && ((beat && who.sprites[beat.emotion]) || who.sprites.neutral || who.avatarUrl)
      return h('div', { onClick: advance, style: { display: 'flex', flexDirection: 'column', height: fullscreen ? '100%' : 420, borderRadius: fullscreen ? 0 : 8, overflow: 'hidden', cursor: 'pointer', color: '#fff' } },
        h('div', { style: { position: 'relative', flex: '1 1 auto', minHeight: 0, background: 'linear-gradient(160deg, ' + light + ', ' + dark + ')', transition: 'background .8s' } },
          h('div', { style: { position: 'absolute', top: 10, left: 12, fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(0,0,0,.35)' } }, '氛围：' + mood),
          picture ? h('img', { src: picture, alt: '', style: { position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', height: '92%', borderRadius: '10px 10px 0 0', boxShadow: '0 10px 40px rgba(0,0,0,.4)' } }) : null),
        h('div', { style: { flex: 'none', minHeight: 96, padding: '10px 14px', background: 'rgba(12,14,20,.92)' } },
          beat && beat.kind === 'line' ? h('div', { style: { fontWeight: 600, marginBottom: 4 } }, beat.speaker) : null,
          h('div', { style: { lineHeight: 1.6 } }, beat ? beat.text : '还没有可以演出的正文'),
          footer))
    }

    return {
      name: 'dsh-card-hello-mood',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStageView !== 'function') return
        ui.registerStageView({ id: 'mood', label: '金麦穗舞台', render: input => h(Stage, { ui, ...input }) })
      },
    }
  },
})
