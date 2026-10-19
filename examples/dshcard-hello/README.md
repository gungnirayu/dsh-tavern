# 阿芙拉 · 最小 DSH 人物卡示例

一张几十 KB 的完整 DSH 人物卡，照着它做你自己的卡。制作说明见 [DSH 人物卡制作指南](../../docs/dshcard-guide.md)。

- 人物卡文字来自仓库里的原创示例卡 [阿芙拉](../avra/cards/avra-complete.json)。
- `assets/`：卡面头像和一张立绘（导入后成为「角色素材」里 neutral 情绪的立绘）。
- `plugin/`：卡内插件。宿主侧每轮在后台结算里顺带判断这一幕的氛围并按轮保存，本局设置里有一个开关；浏览器侧用 `registerStageView` 画舞台，底色跟着氛围变。
- `build.mjs`：打包。

```sh
node examples/dshcard-hello/build.mjs
```

生成 `examples/dshcard-hello/阿芙拉.dshcard`（不进仓库）。在 DSH Tavern 测试版的人物卡库导入、刷新页面，用阿芙拉开一局。
