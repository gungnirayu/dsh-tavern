import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameTitles, gamePlaceholderTitle } from '../tavern-plugin/lib/domain/game-titles.js'

function fakeTitles() {
  const titles = new Map(), refreshed = []
  return {
    titles, refreshed,
    get: session => titles.get(session.id),
    rename(session, title) { titles.set(session.id, { title, source: { kind: 'user' }, messageSeqs: [] }) },
    async refresh(session) { refreshed.push(session.id); titles.set(session.id, { title: '她在偷吃米饭', source: { kind: 'provider' } }); return titles.get(session.id) }
  }
}

test('新游戏先用卡名命名，第一轮后换成 DSH 按玩家输入生成的标题；玩家改过名就不动', async () => {
  const service = fakeTitles()
  const sessions = new Map([['g1', { id: 'g1' }], ['g2', { id: 'g2' }], ['g3', { id: 'g3' }]])
  const titles = createGameTitles({ sessionTitle: () => service, sessions })
  assert.equal(titles.name('g1', '大肥鱼'), true)
  assert.equal(service.titles.get('g1').title, '大肥鱼的新对话')
  assert.equal(await titles.afterTurn('g1', '大肥鱼'), true)
  assert.equal(service.titles.get('g1').title, '她在偷吃米饭')
  assert.equal(await titles.afterTurn('g1', '大肥鱼'), false, '已有正式标题后不再生成')

  titles.name('g2', '大肥鱼')
  service.rename({ id: 'g2' }, '我的存档')
  assert.equal(await titles.afterTurn('g2', '大肥鱼'), false)
  assert.equal(service.titles.get('g2').title, '我的存档')

  service.titles.set('g3', { title: '旧标题', source: { kind: 'fallback' } })
  assert.equal(titles.name('g3', '大肥鱼'), false, '已有标题的不改名')
  assert.equal(gamePlaceholderTitle(''), '游戏的新对话')
  assert.equal(titles.name('missing', '大肥鱼'), false)
})
