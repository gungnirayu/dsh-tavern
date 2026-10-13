# 前台正文提示词的特殊处理

核对日期：2026-10-01。本文记录当前原生游玩模式（story/script）的实现，不代表 SillyTavern 兼容请求模式。

## 请求内容放在哪里

| 内容 | 注入位置 | 处理方式 |
| --- | --- | --- |
| 人物卡故事设定 | system | 开局保存上下文快照，形成会话稳定前缀 |
| 人物卡系统提示 `system_prompt` | system；变化时追加 user 消息 | 开局求值后固定；后续宏求值结果变化时追加完整新版本，同值不重复追加 |
| 人物卡历史后指令 `post_history_instructions` | 本轮附加的 user 消息 | 每轮提供，保留本轮提醒语义 |
| 常驻世界书 | system | 纳入开局快照；当前模板上下文可替换常驻世界书段落 |
| 已启用、已确认的长期用户偏好 | system | 随开局上下文保存 |
| 共同创作约定 | user → assistant → user 种子对话 | 初始化会话时写入 |
| 已有正文、玩家输入 | 对话消息 | 玩家输入按本轮演出指引理解 |
| 本轮命中的世界书、现场状态、剧本参考、演出与写作规则 | 本轮附加的 user 消息 | 统一组装为 ForegroundFrame，存在相应内容时加入 |

这里的“稳定前缀”指内容和结构保持稳定，便于复用；不表示它只发送一次，也不保证供应商一定命中缓存。人物卡上下文是规划、投影后的文本，不是直接发送整个卡片 JSON；世界书也不是每轮无条件全文发送。

## 1. 替换通用助手的 system 内容

原生游玩组装 system 时，直接用酒馆的固定上下文段落替换继承的 sections，避免带入 DSH 通用助手人格和工作环境提示。正文演出规则通过本轮 ForegroundFrame 提供，并非全部放在 system。

来源：[foreground-orchestration-strategies.js](../../tavern-plugin/lib/domain/foreground-orchestration-strategies.js)，`createNativePlayOrchestrationStrategy` 内的 `assembleSystemPrompt`。

## 2. 固定故事设定，单独处理当前世界书

开局构建 `cardContextSnapshot`，包含规划后的人物卡、人物卡系统提示、常驻世界书，以及启用且已确认的长期偏好。已有符合版本要求的快照优先复用；缺失或版本落后时会重建迁移。

人物卡系统提示独立成 `tavern:card-system-prompt` 段落。后续正文准备仍按现有宏机制求值，但不再把系统提示塞入每轮 ForegroundFrame。当前结果与开局版本或模型可见的最新更新相同时不追加；变化时追加完整版本，并声明替代此前的人物卡系统指令。清空后追加失效说明；重新恢复开局值也会追加，避免旧动态版本继续生效。更新消息独立于短期 Frame，清理 Frame 不会移除它。

比较依据是当前 Session Surface 与本次待发送消息，恢复、回退、重生成和压缩后可重新补入缺失的更新。旧会话的开局快照没有系统提示时，下一轮通过追加补入，不为此重写已有 system 前缀。导入历史也使用保存的开局快照作为比较基线。这里沿用已支持的宏求值，不新增 EJS 执行能力。

稳定上下文拆成用户偏好、人物卡、常驻世界书等 system 段落。请求组装还会调用当前世界书模板上下文处理：`withCurrentWorldbook` 移除原常驻段落，再按当前结果放入常驻段落。因此，存在模板求值等情况时，不能把所有世界书内容都理解为永久不变的前缀。

来源：[play-card-snapshots.js](../../tavern-plugin/lib/domain/play-card-snapshots.js)、[session-stable-prefix.js](../../tavern-plugin/lib/domain/session-stable-prefix.js)、[card-system-prompt.js](../../tavern-plugin/lib/domain/card-system-prompt.js)、[turn-lifecycle.js](../../tavern-plugin/lib/hooks/turn-lifecycle.js) 的 `system-prompt/assemble`。

## 3. 用种子对话建立互动方式

会话初始化时预置三条消息：

1. 用户声明共同创作沉浸式小说；人物卡、世界书、正文和现场状态构成故事事实；后续输入是演出指引；只输出正文。
2. 助手确认按连续故事世界处理，重新组织完整场景，人物保持自身性格，只输出正文。
3. 用户要求从人物卡给定的开场继续。

这是程序写入的示范对话，不是额外调用模型生成的确认回复。写入有顺序和完整性检查，避免重复或残缺种子轨迹。

来源：[session-seed-trajectory.js](../../tavern-plugin/lib/domain/session-seed-trajectory.js)。

## 4. 玩家输入是演出指引，不是已经发生的正文

默认正文规则要求：

- 模型叙述和扮演所有角色；其他角色可以依人设拒绝、反对或打断玩家。
- 无标记输入视为人物行为；“场景变化”允许结束或开启场景。
- 承接上一段现场，完整演出玩家输入的核心意图，不能从输入结尾接着写而跳过过程。
- 不照搬整段指引的开头或叙述句式；明确指定的对白可以保留意思或必要原句。
- 同一动作和对白只演一次；避免重复之前剧情或在无意义内容上铺陈。
- 只输出小说正文，不解释、点评或输出元信息；篇幅由剧情决定。

来源：[story.md](../../tavern-plugin/prompts/story.md)。这是仓库默认规则；具体请求还可能有预设和脚本贡献的内容。

## 5. 动态世界书在正文提交后预先匹配

常规关键词匹配基于上一轮正文，在本地完成并保存下一轮上下文。下一轮准备时读取已保存的结果，不因玩家新输入或候选项选择再次触发匹配。

脚本显式提供的扫描文本单独复用匹配器；模板世界书也有独立投影处理。两者不能和常规正文关键词匹配混为一谈。

来源：[turn-orchestration.js](../../tavern-plugin/lib/domain/turn-orchestration.js)，正文准备阶段的 `worldBookContext` 组装。

## 6. 本轮材料统一组装，避免重复追加

本轮卡片上下文、命中世界书、现场状态、剧本参考、指引和写作规则按来源收集到 ForegroundFrame。适配器在第一步将有内容的 frame 作为一条 `role: user` 消息追加；按 frameId 检查重复，非第一步不再次追加。

使用官方 MVU 时，还会明确要求：“变量更新由正文提交后的后台 Agent 独立结算。只输出剧情正文，不要输出 <UpdateVariable>、JSON Patch 或变量更新说明。”

来源：[agent-input-frame.js](../../tavern-plugin/lib/domain/agent-input-frame.js)、[foreground-frame-session-adapter.js](../../tavern-plugin/lib/domain/foreground-frame-session-adapter.js)、[turn-orchestration.js](../../tavern-plugin/lib/domain/turn-orchestration.js) 的 `foregroundFrameInputs`。

## 与文生图 Agent 的区别

文生图 Agent 复用同一游戏的开局人物卡、常驻世界书和已确认长期偏好，作为自己的 system 稳定前缀。它保留独立的生图职责，不继承前台种子对话、演出规则或整份预设。为避免后续剧情污染历史配图，不使用后台结算的最新动态世界书替换；目标轮次的变化由本次材料、已保存方案和历史参考工具提供。

来源：[index.js](../../tavern-plugin/lib/index.js) 的 `resolveStablePrefix`、[background-agent-task.js](../../tavern-plugin/lib/background-agent-task.js)。

### 后台提示词对照（同日核对）

| 处理 | 结算／候选 Agent | 生图 Agent |
| --- | --- | --- |
| 系统职责 | 后台专用 persona | 生图专用 persona |
| DSH 通用运行环境 | 抑制注入 | 抑制注入 |
| 开局稳定前缀 | 人物卡、常驻世界书、已确认偏好 | 复用相同来源；首次任务写入，后续复用 |
| 当前常驻模板世界书 | 每次任务解析，任务内固定，替换常驻段落 | 不读取最新轮次替换，避免历史场景穿越 |
| 每轮输入 | 权威状态、最近剧情、任务协议作为 user 内容 | 目标场景材料、方案与任务协议作为 user 内容 |
| 人物卡系统提示 | 开局纳入固定前缀，明确仅约束候选文本写作；候选任务求值变化时追加完整版本 | 不注入；手机私聊也不注入 |
| 人物卡历史后指令 | 仅候选任务追加到本轮任务消息 | 不注入 |
| 外部 Tavern 预设 | 不继承前台整份预设 | 同左 |
| 工具 | 按任务与配置提供 | 生图任务工具及只读人物设计／参考资料工具 |

注意：任务参数虽然叫 `system`，在 `backgroundPrompt` 中会进入 user 消息的“任务要求”段落；不要把参数名称当作实际消息角色。稳定前缀保存在会话快照元数据中，消息正文为空，system 组装时读取，避免再作为剧情文本重复发送。已有无前缀的生图会话在下一次任务时可补入前缀。

候选与结算共享后台 Session，因此人物卡系统提示在固定前缀中带有作用范围说明，切换任务时不增删这段 system 内容；结算、筛选、人物设计遵循各自任务协议。候选的动态更新同样限定为写作约定，不替换后台职责或结构化输出协议。

2026-09-12 验证：后台 runner、稳定前缀、生图提示词及历史参考资料相关测试共 45 项通过。新增测试覆盖生图连续两次任务的 system 稳定性、三个背景段落的注入，以及不在任务正文中重复背景。此为本地模拟请求验证，未调用真实模型或图片服务。

2026-10-01 验证：人物卡系统指令、正文与后台候选、开局快照、历史导入和动态世界书相关测试共 93 项通过。真实 DSH Agent 配合本地脚本模型验证前台连续五轮的 system 与已有消息逐字稳定、宏变化后追加、候选后台重启后的去重、任务切换，以及生图和手机私聊的隔离；另覆盖清空、回退、压缩和旧会话补入。未调用付费模型，未测量供应商缓存命中率。

## 卡片 Agent 的长期偏好

卡片工作台也将默认启用、已确认的长期偏好注入 system。新会话保存一次偏好快照；已有普通卡片会话在下次请求时补入一次。默认关闭或只有草案时不注入，关闭状态同样保存，后续修改偏好库不会自动替换已有会话的 system 快照。

普通卡片工作台的 system 顺序为：system 附加指令、长期偏好、卡片 Agent 职责、资源工作区。普通工作台只保存偏好上下文；`cardTask: edit` 仍沿用其原有的故事上下文实验。默认注入的偏好与面板正在编辑的条目分别保存，长期偏好的读取、保存和确认工具继续操作会话建立时选中的管理条目。

system 附加指令在请求组装时读取，启用且非空时放在最前面，卡片 Agent 同样适用。修改或清空在下一次请求生效，因此修改它会改变请求前缀。

来源：[conversation-initialization.js](../../tavern-plugin/lib/domain/conversation-initialization.js)、[play-card-snapshots.js](../../tavern-plugin/lib/domain/play-card-snapshots.js)、[foreground-orchestration-strategies.js](../../tavern-plugin/lib/domain/foreground-orchestration-strategies.js)、[user-profile.js](../../tavern-plugin/lib/tools/user-profile.js)、[system-append.js](../../tavern-plugin/lib/domain/system-append.js)。

2026-10-01 验证：相关测试共 71 项通过，客户端构建检查通过。真实 DSH Agent 配合本地脚本模型验证连续三次请求：偏好只进入 system 且保持快照，system 附加指令修改、清空在下一次请求生效。另覆盖各卡片入口、旧会话补入、默认关闭、草案排除，以及管理工具与默认注入条目的分离；未调用付费模型。

## 卡片 Agent 的人物卡参考

绑定了人物卡的新卡片会话（包括“修改人物卡”任务）标记 `cardReferenceContext.version = 1`，开局时与前台一样构建人物卡快照：人物卡基本信息、人物卡自带系统提示与常驻世界书，排在长期偏好之后一并冻结，不逐轮刷新。卡片 Agent 会修改这张卡，所以只保存参考文本，不保存 `cardDefinitionSnapshot`、内容摘要或场景世界书，后续读取始终使用当前文件。后置指令和关键词条目不注入。

system 顺序为：system 附加指令、长期偏好、卡片 Agent 职责、参考资料说明（[card-reference.md](../../tavern-plugin/prompts/card-reference.md)）、人物卡、人物卡系统提示、常驻世界书、资源工作区。卡片 Agent 人设保持不变；说明段提醒这些资料只是开局参考，不是要扮演的角色，修改后以工具读取为准。未绑卡的工作台和已有旧会话保持只有偏好；此前“修改人物卡”实验创建的 `cardEditContext.version = 1` 会话仍沿用前台人设与种子轨迹，新会话不再创建该标记。
