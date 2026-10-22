# 插件开发：读取游戏

宿主侧 `ctx.tavern` 中读取游戏状态、监听回合与时间线变化的接口。

## `apiVersion`

当前为 `3`。以后新增能力时会增大，旧能力保持不变。浏览器侧的 `tavernUi.apiVersion` 单独计数，当前是 `5`。标着「第 3 版」的接口，先判断 `apiVersion >= 3` 再用；旧版 Tavern 上没有时，关掉插件里对应的功能即可。

## `onTurnSettled(handler)`

一轮正文写完、后台变量结算结束（成功或失败）后调用一次。同一个 `textVersion` 只通知一次；插件没加载时发生的轮次不补发；开场白不触发，需要时用 `getTurn` 读第 1 轮。

`handler` 收到：

```js
{
  gameId, turn, textVersion,
  greeting,      // 这一轮是不是开场白（onTurnSettled 里总是 false）
  text,          // 这一轮正文的纯文本（去掉了 HTML 标签与程序块，宏已展开）
  rawText,       // 模型原始输出（含插件让模型写进正文的标记）
  card: { id, name },  // id 是人物卡在库里的位置，卡被移动或改名后可能变化
  variables,     // 这一轮结算后的消息变量（副本），没有时为 null
  settledAt,     // 毫秒时间戳
}
```

`variables` 与 SillyTavern 的消息变量同一结构：使用 MVU 变量的卡，变量在 `variables.stat_data` 下。它跟着正文版本走：回退、重新生成、切换版本后读到的是当前显示版本的变量。这是副本，直接改它不影响游戏，要改请用 `setVariables`；Tavern 不解释其中的内容（例如游戏日期），由插件按卡自己的变量名读取。

处理函数里抛错不会影响游戏，错误会写进日志。处理函数不必等生图完成才返回。

## `getTurn({ gameId, turn })`

读某一轮**当前显示版本**的同一份内容（含 `variables`，不含 `settledAt`）。这一轮不存在、或者是还没结算完的最新一轮时返回 `null`。用于插件自己的「手动生成」按钮。只读这一轮，不读整局历史，可以按需随时调用。

## `getTurnState({ gameId })`（第 2 版）

这一局现在的状态，供需要知道「当前是哪一轮、能不能操作」的插件使用：

```js
{
  gameId,
  turn,          // 最新一轮（正文还在生成时，是上一轮写完的那一轮）
  textVersion,   // 最新一轮当前显示的正文版本
  greeting,      // 最新一轮是不是开场白
  generating,    // 前台正在写正文
  settling,      // 后台正在结算（或即将开始）
  busy,          // generating 或 settling
  settled,       // 最新一轮已写完、后台结算已结束
}
```

回退、撤销回退、重新生成后读到的是回退后的当前状态。浏览器侧用 `tavernUi.getTurnState` / `watchTurnState`。

## `getCardContext({ gameId, turn })`

读这一轮可用的设定材料，供插件写画面提示词：

```js
{
  description,   // 人物卡描述
  personality,   // 性格
  scenario,      // 开场情境
  lore,          // 这一轮正文生成时启用的世界书条目：[{ title, keys, constant, content }]
}
```

`lore` 是生成那一刻保存的快照，后来改世界书不影响已写完的轮次；是否与正文相关由插件自己按 `keys` 和 `constant` 判断。没有快照的旧轮次返回空数组。这一轮不可读时抛错。只读这一轮的设定材料，不读整局历史。

## `getRequestContext({ gameId, turn })`（第 3 版）

读 Tavern 为这一轮**正文请求**准备的本轮上下文，供导演、配图这类后台任务拿到和正文模型同一份材料，不用自己从人物卡、世界书里再拼一遍：

```js
{
  turn,
  input,       // 玩家这一轮的输入（经宏展开等处理后发给模型的样子）
  sections: [  // 按发给模型的顺序
    { slot: 'activeWorldbook', origin: 'tavern:world-book', text },
    { slot: 'currentStateProjection', origin: 'plugin', plugin: 'memory', name: 'recent', text },
  ],
}
```

- `slot` 是这段在请求里的位置：`cardContext`（人物卡材料）、`activeWorldbook`（本轮世界书）、`currentStateProjection`（现场状态）、`scriptReference`（剧本）、`guide`、`writingRules`（写作要求）。
- `origin` 说明来源：`tavern:<种类>` 是 Tavern 自己的，`preset` 来自预设，`plugin` 来自插件的 `turnSection` / `worldbookSource`（带 `plugin`、`name`）。
- 只含**本轮上下文**，不含固定前缀（人物卡描述等，用 `getCard`、`getCardContext` 读）和历史消息（用 `getHistory`）。
- 是这一轮在当前剧情分支上**最近一次**准备的请求；Tavern 只保留最近 40 次准备，更早的轮次返回 `null`。重新生成后读到的是新请求的。

## `getCard({ gameId })`（第 2 版）

读这局正在玩的人物卡，返回 SillyTavern 角色卡的数据（`name`、`description`、`personality`、`scenario`、`first_mes`、`character_book`、`extensions` 等，以卡里实际有的字段为准）。开局时保存了人物卡快照的游戏，读到的是快照，和正文生成用的是同一份。返回的是副本，改它不影响游戏。

## `getCardImage({ gameId })`（第 2 版）

读这局人物卡的图片，返回 `{ url, mediaType }`，卡没有图片（例如 JSON 格式的卡）时返回 `null`。`url` 是酒馆页面里可以直接显示的地址（例如 `<img src>`），只读；读到的是人物卡库里这张卡当前的图片，卡从卡库删除后返回 `null`。浏览器侧经 `callHost` 让宿主侧调用即可。

## `getHistory({ gameId, from, to })`（第 2 版）

读第 `from` 到 `to` 轮已经写完的正文，一次最多 50 轮（省略 `to` 时读 50 轮）。返回 `[{ turn, input, text, rawText }]`：`input` 是玩家这一轮发的话（开场白为空），`text`、`rawText` 的含义同 `onTurnSettled`。还在生成、结算中的最新一轮不返回。只读要的那几轮，长局也不会读整局历史。

## `getCharacterDesigns({ gameId })`、`saveCharacterDesign({ gameId, name, ... })`（第 2 版）

这一局的人物设计档案（酒馆状态里的「人物设计档案」）：正文、结算和插件读同一份，生图插件画人物时用它，文字和图片的人物设定就不会各说各的。

```js
const { characters } = await ctx.tavern.getCharacterDesigns({ gameId })
// [{ name, aliases, identity, narrativeRole, updatedAt, sections: [{ key, label, text }] }]
const look = characters.find(person => person.name === '林岚')?.sections.find(section => section.key === 'appearance')?.text
```

- `sections` 的 `key` 为 `identity`（身份）、`personality`（性格）、`appearance`（外貌）、`speechStyle`（说话方式）、`narrativeRole`（剧情作用），只列出有内容的项。还没有档案时 `characters` 为空数组。
- `saveCharacterDesign` 新建或更新一个人物，规则和后台结算自己建档时相同：`name`、`identity`、`personality`、`appearance`、`speechStyle`、`narrativeRole` 都要写完整，`aliases` 可选；同名人物会被更新。保存后这个人物同步进本局世界书，后续正文和结算都会用到。适合生图插件根据参考图修订外貌后写回，让文字跟着同一份设定走。
- 档案在后台结算时也会更新，需要最新内容时在 `onTurnSettled` 里重新读取。插件不在这一局生效时，保存会被拒绝。

## `backgroundModel({ gameId })`

返回这一局 Tavern 使用的后台模型 `{ provider, model, reasoningEffort? }`，没有时为 `null`。`reasoningEffort` 是这局设置的后台推理强度，没设置时不含这个字段。插件可以用它通过 DSH 的 `llm` 服务做自己的规划，不必让用户再选一次模型。

## `onTimelineChanged(handler)`（第 2 版）

这一局的剧情线变了之后调用：回退、撤销回退、重新生成、编辑正文、分叉。`handler` 收到 `{ gameId, kind, turn?, textVersion?, fromGameId? }`，`kind` 是 `rollback`、`undo-rollback`、`regenerate`、`edit`、`fork` 之一；`textVersion`（第 3 版）是变化之后第 `turn` 轮当前显示的正文版本，这一轮已不存在时没有这个字段；`fork` 时 `gameId` 是新游戏，`fromGameId` 是原游戏。以后可能增加新的 `kind`，不认识的请忽略。通知在变化保存之后发出。

这个通知只是告知。插件的按轮数据会自动跟着剧情线走（见[媒体与数据](plugin-api-data.md)的「插件存档数据」），不需要在这里同步。编辑正文后，Tavern 还会对新的正文版本再发一次 `onTurnSettled`，插件可以据此重算这一轮。

## `versionSignal({ gameId, turn, textVersion })`（第 3 版）

返回一个 `AbortSignal`：这一轮的 `textVersion` 一旦不再是当前显示的版本（回退、重新生成、编辑正文、删局），它就中止，`signal.reason.code` 为 `TAVERN_PLUGIN_STALE_VERSION`。传入时已经不是当前版本的，直接返回已中止的信号。

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, text }) => {
  const signal = await ctx.tavern.versionSignal({ gameId, turn, textVersion })
  const plan = await myDirector(text, { signal })          // 版本失效时自己的模型请求跟着停
  await ctx.tavern.saveTurnData({ gameId, turn, textVersion, data: plan })  // 版本失效时这里也会被拒
})
```

- 适合插件自己开的长任务（导演、生图、配音预合成）：剧情一变就停，不用自己监听 `onTimelineChanged` 再比对版本。
- 结算任务 `run` 收到的 `signal` 已经包含它，不用再取。
- 只负责「停」：迟到的写入照样由 `textVersion` 拦下（`saveTurnData`、`attach`、`setVariables`、`editTurn` 都会拒绝旧版本），插件不需要另做提交、回滚。
- 插件卸载后，它取的信号不再更新。

## `onGameRemoved(handler)`

一局游戏被删除时调用，收到 `{ gameId }`，供插件清理自己按局保存的数据。插件挂到这局上的媒体项由 Tavern 一并清理。

## 改最新一轮（第 2 版）

两个接口都只能改**最新一轮**，并且要等这一轮写完、后台结算结束；适合在 `onTurnSettled` 里调用。都要带上 `textVersion`：期间玩家回退、重新生成或已经改过，会报 `TAVERN_PLUGIN_STALE_VERSION`，什么也不改。插件不在这一局生效时也会被拒绝。

### `setVariables({ gameId, turn, textVersion, variables })`

用 `variables` 整个替换这一轮当前版本的消息变量（结构同 `onTurnSettled` 收到的 `variables`，MVU 卡的数据在 `stat_data` 下）。先读、改、再整个写回：

```js
ctx.tavern.onTurnSettled(async ({ gameId, turn, textVersion, variables }) => {
  if (!variables?.stat_data) return
  const next = structuredClone(variables)
  next.stat_data.世界.日期 = advance(next.stat_data.世界.日期)
  await ctx.tavern.setVariables({ gameId, turn, textVersion, variables: next })
})
```

- 改完后状态栏随即刷新，下一轮正文和后台结算都以改过的变量为准。
- Tavern 不检查变量结构，写错了会直接影响状态栏和后续结算，请按这张卡的变量结构写。最大 1 MB。
- 这一轮的后台结算还没结束时报 `TAVERN_PLUGIN_TURN_UNAVAILABLE`，下一轮正文已经在生成时报 `TAVERN_PLUGIN_BUSY`，都是稍后再试；在 `onTurnSettled` 里调用就不会遇到。

### `editTurn({ gameId, turn, textVersion, text })`

用 `text` 替换这一轮的正文，走的是玩家「编辑正文」同一条路：回退、分叉照常，宏、脚本和结算不会重跑。返回改后这一轮的内容（同 `getTurn`），里面有新的 `textVersion`。

- `text` 是完整的新正文，请在 `rawText` 的基础上改；不要拿 `text` 字段去改，它去掉了 HTML 块，交回来会被拒绝。正文里的 HTML 块（状态栏、美化代码等）必须原样保留，只能改它们之间的文字，也不能在 HTML 块之间新增段落。
- 改完后所有插件会再收到一次这一轮的 `onTurnSettled`（`textVersion` 是新的）。在 `onTurnSettled` 里改正文的插件，要先判断是不是已经改过，避免反复修改。
