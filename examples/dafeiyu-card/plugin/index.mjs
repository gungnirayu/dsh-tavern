// 大肥鱼卡内插件（宿主侧）：Galgame 式演出的最小可行版。
// 读这张卡带的素材包（Galgame 分支的 dsh-asset-pack），每轮在后台结算里顺带"导演"：
// 换场景（背景与时段）、换服装、换背景音乐。结果存成按轮数据，浏览器侧的舞台画面按它显示。
// 只用插件接口：listCardPacks / readCardPackFile 读素材，settlementSection + settlementTool 导演，
// saveTurnData / readTurnData 存结果，handle 给浏览器侧读场景。

export const name = 'dsh-card-dafeiyu-galgame'
export const inject = ['tavern']

const TOOL = 'galgame_direct'
const MAX_SCENES = 12

// SillyTavern's 28 emotions (Tavern's line annotations) → this figure's own expressions.
const EMOTIONS = { joy: 'joy', amusement: 'joy', excitement: 'joy', optimism: 'joy', approval: 'joy', gratitude: 'joy', relief: 'joy', admiration: 'joy', caring: 'joy',
  anger: 'anger', annoyance: 'anger', disapproval: 'anger', sadness: 'sad', grief: 'crying', disappointment: 'sad', remorse: 'sad',
  nervousness: 'anxious', fear: 'anxious', confusion: 'anxious', surprise: 'anxious', neutral: 'calm', curiosity: 'calm', realization: 'calm',
  embarrassment: 'shy', disgust: 'disgust', love: 'love', desire: 'love', pride: 'smug' }

function words(text) { return String(text || '').toLowerCase() }

// The full-body standing picture of one outfit and emotion, as layers on a canvas (pixels of the canvas).
// The pack's sprite manifest has three shapes: a whole picture (with a stage size), a whole picture
// drawn without a mouth (the closed mouth goes on top), or parts of a rig picked by a recipe.
// The first layer covers the whole canvas. Returns null when the outfit has no standing picture for it.
export function standingPicture(outfit, manifest, emotion, url) {
  const assets = outfit?.sprite?.assets || {}
  const media = path => url(assets[path])
  // Some pictures were never measured; they share the canvas of the outfit's default one.
  const anatomy = outfit?.sprite?.anatomy?.[emotion] || outfit?.sprite?.anatomy?.[outfit?.defaultEmotion] || {}
  const frame = { top: anatomy.figureTop ?? 0, feet: anatomy.feet ?? 1, x: anatomy.supportX ?? 0.5 }
  const render = manifest?.emotions?.[emotion]?.render
  const legacy = render?.kind === 'whole' ? render.legacy : manifest?.kind === 'layered-static-sprites' ? manifest : null
  let canvas = null, layers = []
  if (render?.kind === 'parts') {
    const rig = manifest.rigs?.[render.rig], recipe = rig?.recipes?.[render.recipe]
    if (!rig || !recipe) return null
    canvas = rig.canvas
    for (const group of rig.drawOrder || []) {
      const part = rig.parts?.[recipe.selection?.[group]]
      if (part) layers.push({ url: media(part.src), rect: part.rect })
    }
  } else if (legacy) {
    const entry = legacy.emotions?.[emotion]
    if (!entry) return null
    if (entry.stage) {
      canvas = [entry.stage.width, entry.stage.height]
      layers.push({ url: media(entry.stage.src), rect: [0, 0, ...canvas] })
    } else if (entry.src) {
      canvas = entry.binding?.canvas || null
      layers.push({ url: media(entry.src), rect: canvas ? [0, 0, ...canvas] : null })
      const mouth = entry.binding?.mouth, set = mouth && legacy.rig?.mouthSets?.[mouth.set]
      if (canvas && mouth?.surface === 'mouthless' && set?.frames?.closed) {
        const scale = mouth.anchor?.scale ?? 1, [w, h] = set.canvas, [px, py] = set.pivot || [0, 0]
        layers.push({ url: media(set.frames.closed), rect: [mouth.anchor.x - px * w * scale, mouth.anchor.y - py * h * scale, w * scale, h * scale] })
      }
    }
  }
  if (!layers.length || layers.some(layer => !layer.url)) return null
  return { canvas, layers, ...frame }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  const catalogs = new Map()

  // What this card's packs offer, read once per game: figure and outfits, backgrounds, music, opening scene.
  async function catalog(gameId) {
    if (catalogs.has(gameId)) return catalogs.get(gameId)
    const job = (async () => {
      const packs = await tavern.listCardPacks({ gameId })
      const json = async (pack, path) => JSON.parse(Buffer.from((await tavern.readCardPackFile({ gameId, pack: pack.id, path })).data).toString('utf8'))
      const result = { figure: null, figureBase: '', figureBlobs: {}, sprites: {}, scenes: [], music: [], opening: null }
      for (const pack of packs.filter(item => item.format === 'dsh-asset-pack')) {
        const manifest = await json(pack, 'manifest.json')
        const media = hash => hash && manifest.blobs?.[hash] ? pack.baseUrl + encodeURIComponent('media/' + hash + '.' + manifest.blobs[hash].ext) : ''
        for (const figureId of manifest.figures || []) {
          if (result.figure) continue
          result.figure = await json(pack, 'figures/' + figureId + '.json')
          result.figureMedia = media
          for (const [key, path] of Object.entries(manifest.sprites || {})) result.sprites[key] = await json(pack, path).catch(() => null)
        }
        for (const asset of manifest.assets || []) {
          if (asset.enabled === false) continue
          if (asset.kind === 'backgrounds') {
            const variants = Object.fromEntries((asset.variants?.entries || []).map(entry => [entry.id, media(entry.content?.media)]).filter(([, url]) => url))
            if (Object.keys(variants).length) result.scenes.push({ id: asset.id, name: asset.name, category: asset.category || '', keywords: [asset.name, ...(asset.recall?.keywords || []), ...Object.values(asset.recall?.synonyms || {}).flat()], variants, fallback: asset.variants?.default || Object.keys(variants)[0] })
          } else if (asset.kind === 'music' && media(asset.media)) {
            result.music.push({ id: asset.id, name: asset.name, usage: asset.usage || asset.directorNote || '', url: media(asset.media) })
          }
        }
      }
      const card = await tavern.getCard({ gameId })
      const opening = card?.data?.extensions?.dsh_tavern?.openings?.scenes?.primary || card?.extensions?.dsh_tavern?.openings?.scenes?.primary
      result.opening = { scene: opening?.background?.assetId || result.scenes[0]?.id || '', time: opening?.timeOfDay || 'day', outfit: opening?.cast?.[0]?.outfitKey || 'default', music: opening?.music?.assetId || '' }
      return result
    })()
    catalogs.set(gameId, job)
    job.catch(() => catalogs.delete(gameId))
    return job
  }

  // The scene in force at a turn: the last direction at or before it, else the opening.
  async function sceneAt(gameId, turn) {
    const data = await catalog(gameId)
    const record = turn > 0 ? await tavern.readTurnData({ gameId, turn }).catch(() => null) : null
    return { ...data.opening, ...(record?.data || {}) }
  }

  // The player's choices for this card's director, in 本局设置.
  const settings = async gameId => typeof tavern.getGameSettings === 'function' ? await tavern.getGameSettings({ gameId }).catch(() => ({})) : {}
  if (typeof tavern.gameSettings === 'function') tavern.gameSettings({ title: '大肥鱼舞台', fields: [
    { key: 'director', type: 'boolean', label: '舞台导演', description: '每轮按正文换场景、时段、服装和背景音乐。关掉后舞台停在当前的样子。', default: true },
    { key: 'outfits', type: 'boolean', label: '导演换服装', description: '关掉后大肥鱼一直穿现在这套。', default: true }
  ] })

  tavern.settlementSection({ name: 'direct', text: async ({ gameId, turn, text: turnText }) => {
    const data = await catalog(gameId)
    const chosen = await settings(gameId)
    if (!data.scenes.length || chosen.director === false) return ''
    const current = await sceneAt(gameId, turn - 1)
    const text = words(turnText)
    // A short list: scenes the text names, then the current one; the full list would cost too much every turn.
    const named = data.scenes.filter(scene => scene.keywords.some(keyword => keyword && text.includes(words(keyword)))).slice(0, MAX_SCENES)
    const now = data.scenes.find(scene => scene.id === current.scene)
    const scenes = [...(now ? [now] : []), ...named.filter(scene => scene !== now)].slice(0, MAX_SCENES)
    const outfits = chosen.outfits === false ? [] : (data.figure?.outfits || []).filter(outfit => outfit.enabled !== false)
    return ['【舞台导演】按本轮正文，调用一次 ' + TOOL + ' 设定舞台；不需要变化的项省略。场景没有变化时不要换。',
      '当前：场景 ' + (now?.name || '无') + '（' + current.time + '），服装 ' + (outfits.find(outfit => outfit.key === current.outfit)?.label || current.outfit) + '，音乐 ' + (data.music.find(track => track.id === current.music)?.name || '无') + '。',
      '可选场景（id：名称〔可选时段〕）：' + scenes.map(scene => scene.id + '：' + scene.name + '〔' + Object.keys(scene.variants).join('/') + '〕').join('；'),
      outfits.length ? '服装（key：名称——何时穿）：' + outfits.map(outfit => outfit.key + '：' + outfit.label + '——' + (outfit.guidance || '')).join('；') : '',
      data.music.length ? '音乐（id：名称——用途）：' + data.music.map(track => track.id + '：' + track.name + '——' + track.usage).join('；') : ''].filter(Boolean).join('\n')
  } })

  tavern.settlementTool({
    name: TOOL,
    description: '设定这一幕的舞台：场景、时段、服装、背景音乐。只填需要改变的项。',
    parameters: { type: 'object', properties: {
      scene: { type: 'string', description: '场景 id' }, time: { type: 'string', enum: ['day', 'dusk', 'night'] },
      outfit: { type: 'string', description: '服装 key' }, music: { type: 'string', description: '音乐 id' } } },
    async execute({ gameId, turn, arguments: args }) {
      const data = await catalog(gameId)
      const next = await sceneAt(gameId, turn - 1)
      const scene = args.scene ? data.scenes.find(item => item.id === args.scene || item.name === args.scene) : null
      if (args.scene && !scene) return { ok: false, error: '没有这个场景：' + args.scene }
      if (scene) next.scene = scene.id
      if (args.time) next.time = args.time
      const chosen = await settings(gameId)
      if (chosen.director === false) return { ok: false, error: '玩家关掉了舞台导演，本轮不要调用' }
      if (args.outfit && chosen.outfits === false) return { ok: false, error: '玩家关掉了换服装，不要改服装' }
      if (args.outfit) { if (!(data.figure?.outfits || []).some(outfit => outfit.key === args.outfit)) return { ok: false, error: '没有这套服装：' + args.outfit }; next.outfit = args.outfit }
      if (args.music) { const track = data.music.find(item => item.id === args.music || item.name === args.music); if (!track) return { ok: false, error: '没有这首音乐：' + args.music }; next.music = track.id }
      await tavern.saveTurnData({ gameId, turn, data: next })
      return { ok: true }
    }
  })

  // The figure's expression avatars join Tavern's cast, so the story shows her face for each line's emotion.
  tavern.castAssetSource({ name: 'figure', characters: async ({ gameId }) => {
    const data = await catalog(gameId)
    if (!data.figure) return []
    const state = await tavern.getTurnState({ gameId }).catch(() => null)
    const current = await sceneAt(gameId, state?.turn || 0)
    const outfit = (data.figure.outfits || []).find(item => item.key === current.outfit) || data.figure.outfits?.[0]
    const avatar = emotion => data.figureMedia(outfit?.avatars?.[emotion])
    const avatars = Object.fromEntries(Object.entries(EMOTIONS).map(([emotion, own]) => [emotion, avatar(own)]).filter(([, url]) => url))
    return [{ name: data.figure.name, aliases: data.figure.aliases || [], avatarUrl: avatar(outfit?.defaultEmotion || 'calm'), avatars }]
  } })

  // The browser half asks for the scene of the turn it shows, with the URLs it needs.
  tavern.handle('dsh-card-dafeiyu-galgame/scene', async ({ gameId, turn }) => {
    const data = await catalog(gameId)
    const current = await sceneAt(gameId, Number(turn) || 0)
    const scene = data.scenes.find(item => item.id === current.scene)
    const outfit = (data.figure?.outfits || []).find(item => item.key === current.outfit) || data.figure?.outfits?.[0]
    const track = data.music.find(item => item.id === current.music)
    return {
      background: scene ? { name: scene.name, url: scene.variants[current.time] || scene.variants[scene.fallback] } : null,
      time: current.time,
      figure: data.figure ? { names: [data.figure.name, ...(data.figure.aliases || [])], outfit: outfit?.label || '', defaultEmotion: outfit?.defaultEmotion || 'calm',
        avatars: Object.fromEntries(Object.entries(outfit?.avatars || {}).map(([emotion, hash]) => [emotion, data.figureMedia(hash)])),
        standing: Object.fromEntries(Object.keys(outfit?.avatars || {}).map(emotion => [emotion, standingPicture(outfit, data.sprites[outfit.sprite?.manifestKey], emotion, data.figureMedia)]).filter(([, picture]) => picture)) } : null,
      music: track ? { name: track.name, url: track.url } : null
    }
  })
}
