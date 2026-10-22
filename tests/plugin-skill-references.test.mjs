// 写插件的 Skill 带着接口文档的副本，Agent 只读得到副本；副本必须与 docs/ 里的原文一致。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

for (const name of ['plugin-api.md', 'plugin-api-game.md', 'plugin-api-prompt.md', 'plugin-api-data.md', 'plugin-api-cards.md', 'plugin-api-ui.md', 'plugin-recipes.md', 'plugin-publishing.md']) {
  test(`tavern-plugin Skill 的 ${name} 与 docs/${name} 一致`, async () => {
    const source = await readFile(new URL('../docs/' + name, import.meta.url), 'utf8')
    const copy = await readFile(new URL('../presets/tavern/skills/tavern-plugin/references/' + name, import.meta.url), 'utf8')
    assert.ok(copy === source, `改了 docs/${name} 后，复制到 presets/tavern/skills/tavern-plugin/references/${name}`)
  })
}
