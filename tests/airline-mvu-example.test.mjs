import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('展示模板只读，动态文字通过 textContent 展示，没有外链和轮询', () => {
  const view = readFileSync(new URL('../examples/airline-mvu/status.html', import.meta.url), 'utf8')
  assert.doesNotMatch(view, /innerHTML|replaceVariables|updateVariablesWith|setInterval|https?:\/\//)
  assert.match(view, /VARIABLE_UPDATE_ENDED/)
  assert.match(view, /Object.values\(tavern_events\)/)
})
