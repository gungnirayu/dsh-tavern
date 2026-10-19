// 最小卡内插件（宿主侧）：每轮在后台结算里顺带记下这一幕的「氛围」，浏览器侧按它给舞台换底色。
// 用到的接口：gameSettings（本局设置里的开关）、settlementSection + settlementTool（让结算模型顺带做一件事）、
// saveTurnData / readTurnData（按轮存数据，回退和重新生成时自动跟着正文走）、handle（给浏览器侧读）。

export const name = 'dsh-card-hello-mood'
export const inject = ['tavern']

const MOODS = ['warm', 'calm', 'tense', 'night']

export function apply(ctx) {
  const tavern = ctx.tavern
  if (tavern.apiVersion < 2) return

  tavern.gameSettings({ title: '金麦穗氛围', fields: [
    { key: 'mood', type: 'boolean', label: '按剧情换舞台氛围', description: '每轮结算时顺带判断这一幕的氛围，舞台底色跟着变。', default: true }
  ] })
  const enabled = async gameId => (await tavern.getGameSettings({ gameId })).mood !== false

  // 结算模型读到这段说明，就会调用下面的工具。
  tavern.settlementSection({ name: 'mood', text: async ({ gameId }) => await enabled(gameId)
    ? '【氛围】按本轮正文调用一次 hello_mood，从 warm（温暖热闹）、calm（平静）、tense（紧张）、night（夜深）里选一个。'
    : '' })

  tavern.settlementTool({
    name: 'hello_mood',
    description: '记下这一幕的氛围。',
    parameters: { type: 'object', properties: { mood: { type: 'string', enum: MOODS } }, required: ['mood'] },
    async execute({ gameId, turn, arguments: args }) {
      if (!MOODS.includes(args.mood)) return { ok: false, error: '氛围只能是 ' + MOODS.join('、') }
      await tavern.saveTurnData({ gameId, turn, data: { mood: args.mood } })
      return { ok: true }
    }
  })

  // 浏览器侧问：第 turn 轮是什么氛围？读不到时用开场的 warm。
  tavern.handle('dshcard-hello/mood', async ({ gameId, turn }) => {
    if (!await enabled(gameId)) return { mood: 'warm' }
    const record = turn > 0 ? await tavern.readTurnData({ gameId, turn }).catch(() => null) : null
    return { mood: record?.data?.mood || 'warm' }
  })
}
