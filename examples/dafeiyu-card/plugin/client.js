// 大肥鱼卡内插件（浏览器侧）：用 registerStageView 画 Galgame 式舞台。
// 背景、服装立绘、背景音乐都来自宿主侧导演定下的场景；翻页、自动、输入框和音乐播放仍由 Tavern 负责。
window.__ModuleLoader__.load({
  id: 'dsh-card-dafeiyu-galgame',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // SillyTavern's 28 emotions → this figure's own expressions.
    const EMOTIONS = { joy: 'joy', amusement: 'joy', excitement: 'joy', optimism: 'joy', approval: 'joy', gratitude: 'joy', relief: 'joy', admiration: 'joy', caring: 'joy',
      anger: 'anger', annoyance: 'anger', disapproval: 'anger', sadness: 'sad', grief: 'crying', disappointment: 'sad', remorse: 'sad',
      nervousness: 'anxious', fear: 'anxious', confusion: 'anxious', surprise: 'anxious', neutral: 'calm', curiosity: 'calm', realization: 'calm',
      embarrassment: 'shy', disgust: 'disgust', love: 'love', desire: 'love', pride: 'smug' }

    function useScene(ui, gameId, turn) {
      const [scene, setScene] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        ui.callHost('dsh-card-dafeiyu-galgame/scene', { gameId, turn: turn || 0 }).then(value => { if (active) setScene(value) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return scene
    }

    // The full-body picture stands on the floor of the scene, as tall as the scene allows.
    // Its layers are drawn into one canvas at their own pixels: scaled separately, their edges showed as thin lines.
    const TEXTBOX = { stage: 128, fullscreen: 168 }, IMAGES = new Map()
    function image(url) {
      if (!IMAGES.has(url)) IMAGES.set(url, new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url }))
      return IMAGES.get(url)
    }
    function Standing({ picture, alt, speaking, style }) {
      const ref = React.useRef(null)
      const { layers, top, feet, x } = picture
      React.useEffect(() => {
        let active = true
        Promise.all(layers.map(layer => image(layer.url))).then(images => {
          const canvas = ref.current
          if (!active || !canvas) return
          const [width, height] = picture.canvas || [images[0].naturalWidth, images[0].naturalHeight]
          canvas.width = width; canvas.height = height
          const context = canvas.getContext('2d')
          images.forEach((img, at) => { const rect = layers[at].rect || [0, 0, width, height]; context.drawImage(img, Math.round(rect[0]), Math.round(rect[1]), Math.round(rect[2]), Math.round(rect[3])) })
        }, () => {})
        return () => { active = false }
      }, [picture])
      const span = Math.max(0.2, feet - top), room = '(100% - 24px)'
      return h('canvas', { ref, width: 0, height: 0, role: 'img', 'aria-label': alt, style: { ...style, height: 'calc(' + room + ' / ' + span + ')', bottom: 'calc(6px - ' + room + ' * ' + ((1 - feet) / span) + ')',
        transform: 'translateX(' + (-x * 100) + '%)' + (speaking ? ' translateY(-4px)' : ''), pointerEvents: 'none' } })
    }

    function Stage({ ui, gameId, stage, beats, index, beat, fullscreen, advance, footer }) {
      const scene = useScene(ui, gameId, beat && beat.turn)
      // Tavern plays the music and owns the player's switch; it stops when this game's stage goes away.
      const track = scene && scene.music
      React.useEffect(() => { if (scene) ui.playMusic(track ? { url: track.url, title: track.name } : '') }, [gameId, scene && (track ? track.url : '')])
      const figure = scene && scene.figure
      let emotion = figure ? figure.defaultEmotion : 'calm'
      for (const item of beats.slice(0, index + 1)) if (figure && item.kind === 'line' && figure.names.includes(item.speaker)) emotion = EMOTIONS[item.emotion] || figure.defaultEmotion
      const speaking = beat && beat.kind === 'line' && figure && figure.names.includes(beat.speaker)
      const standing = figure && figure.standing && (figure.standing[emotion] || figure.standing[figure.defaultEmotion])
      const portrait = !standing && figure && (figure.avatars[emotion] || figure.avatars[figure.defaultEmotion])
      const figureStyle = { position: 'absolute', left: '50%', transition: 'transform .3s', filter: beat && beat.kind === 'line' && !speaking ? 'brightness(.75)' : 'none' }
      // The scene on top, the text box under it: the box never covers the figure, and the figure keeps its feet on the floor.
      // In full screen Tavern's input bar takes the bottom 88px after the last line.
      return h('div', { onClick: advance, style: { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', paddingBottom: fullscreen ? 88 : 0, height: fullscreen ? '100%' : 440, minHeight: 300, overflow: 'hidden', borderRadius: fullscreen ? 0 : 8, cursor: 'pointer', color: '#fff', background: '#141a26' } },
        h('div', { style: { position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden', background: '#1d2433' } },
          scene && scene.background ? h('img', { src: scene.background.url, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } }) : null,
          scene && scene.background ? h('div', { style: { position: 'absolute', top: 10, left: 12, fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(0,0,0,.4)' } },
            scene.background.name + (scene.music ? ' · ♪ ' + scene.music.name : '')) : null,
          standing ? h(Standing, { picture: standing, alt: figure.names[0], speaking, style: figureStyle }) : null,
          portrait ? h('img', { src: portrait, alt: figure.names[0], style: { ...figureStyle, bottom: 0, transform: 'translateX(-50%)' + (speaking ? ' translateY(-4px)' : ''), maxHeight: '90%', maxWidth: '80%', objectFit: 'contain' } }) : null),
        // A fixed-height box: the pager stays put however long the line is; a long line scrolls inside.
        h('div', { style: { flex: 'none', height: fullscreen ? TEXTBOX.fullscreen : TEXTBOX.stage, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', padding: fullscreen ? '14px max(22px, calc(50% - 480px))' : '10px 14px', borderTop: '1px solid rgba(255,255,255,.08)' } },
          beat && beat.kind === 'line' ? h('div', { style: { flex: 'none', fontWeight: 600, marginBottom: 4, color: speaking ? '#8fb7ff' : '#fff' } }, beat.speaker) : null,
          h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', lineHeight: 1.6, fontStyle: beat && beat.kind === 'narration' ? 'italic' : 'normal' } }, beat ? beat.text : '还没有可以演出的正文'),
          footer))
    }

    return {
      name: 'dsh-card-dafeiyu-galgame',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStageView !== 'function' || typeof ui.playMusic !== 'function') return
        ui.registerStageView({ id: 'galgame', label: '大肥鱼舞台', render: input => h(Stage, { ui, ...input }) })
      },
    }
  },
})
