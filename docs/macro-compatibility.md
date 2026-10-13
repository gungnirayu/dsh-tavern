# 宏兼容范围

人物卡、世界书、预设、用户指导和对话消息里的 SillyTavern 宏当前支持：

- `{{user}}`、`{{char}}`
- 局部变量：`getvar`、`setvar`、`addvar`、`incvar`、`decvar`、`hasvar`、`deletevar`
- 全局变量：`getglobalvar`、`setglobalvar`、`addglobalvar`、`incglobalvar`、`decglobalvar`、`hasglobalvar`、`deleteglobalvar`
- `{{if 条件}}…{{else}}…{{/if}}`，条件可写 `.变量名` / `$全局变量名`
- 注释 `{{// …}}`
- `{{random::a::b::c}}`（也接受逗号分隔）
- `{{roll::1d20}}`、`{{roll: 2d6+1}}`、`{{roll d6}}`；只写数字表示 1dN

不认识的宏不会执行，也不会当成指令发给模型。

## random / roll 的位置

| 位置 | 是否展开 | 何时重新抽取 |
| --- | --- | --- |
| 对话消息、用户指导 | 展开 | 每次请求 |
| 世界书条目 | 展开 | 每轮；同一轮前台、后台结果一致 |
| 预设中段、预设后段 | 展开 | 每轮；同一轮各步骤结果一致，重新生成会重抽 |
| 预设前段 | **不展开**，保留原文 | — |

预设前段是固定的系统前缀。如果每轮都随机，模型的提示词缓存每轮都会失效，所以前段不做随机展开。需要随机的内容请放进预设中段或后段。
