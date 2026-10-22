import assert from 'node:assert/strict'
import test from 'node:test'

import { createInstallStageReporter, installStageFromLine } from '../bin/application-update.mjs'

test('安装器步骤与 DSH_STATUS 转成用户能看懂的阶段', () => {
  assert.equal(installStageFromLine('== [步骤 1] 准备酒馆源码（已用 0s）=='), '第 1 步 · 准备酒馆源码')
  assert.equal(
    installStageFromLine('== [步骤 3] 安装依赖并配置 Profile（最慢的一步，日志会持续输出）（已用 62s）=='),
    '第 3 步 · 安装依赖并配置 Profile（最慢的一步，日志会持续输出）')
  assert.equal(
    installStageFromLine('DSH_STATUS 下载代码（jsDelivr）：2/8 文件，复用 1，已下载 1.2 MB'),
    '下载代码（jsDelivr）：2/8 文件，复用 1，已下载 1.2 MB')
  assert.equal(installStageFromLine('   '), '')
  assert.equal(installStageFromLine('Progress: resolved 12, reused 3'), '')
  assert.equal(
    installStageFromLine('Progress: resolved 0, reused 120, downloaded 3, added 118'),
    '安装依赖：已装 118，复用 120，下载 3')
  assert.equal(installStageFromLine('DSH_STATUS'), '')
})

test('跨块的 UTF-8 字符不产生乱码，阶段只在变化时上报、进展按心跳节流', () => {
  const stages = []
  let progress = 0
  let now = 6000
  const reporter = createInstallStageReporter({
    onStage: stage => stages.push(stage), onProgress: () => { progress += 1 }, now: () => now, heartbeatMs: 5000,
  })
  const text = Buffer.from('== [步骤 2] 安装依赖（已用 3s）==\nDSH_STATUS 下载代码：1/8\nDSH_STATUS 下载代码：2/8\n', 'utf8')
  // Split inside the first Chinese character of the step title.
  const cut = text.indexOf(Buffer.from('安')) + 1
  reporter.push(text.subarray(0, cut))
  assert.deepEqual(stages, [])
  reporter.push(text.subarray(cut))
  assert.deepEqual(stages, ['第 2 步 · 安装依赖', '下载代码：1/8', '下载代码：2/8'])
  assert.equal(progress, 1, '同一秒内的多行输出只刷新一次进展')
  now = 12000
  reporter.push(Buffer.from('下载中\n', 'utf8'))
  assert.equal(progress, 2, '心跳按时间窗刷新，不受行数影响')
  reporter.end()
  assert.deepEqual(stages.slice(0, 3), ['第 2 步 · 安装依赖', '下载代码：1/8', '下载代码：2/8'])
})

test('结束前没有换行的最后一行仍会处理', () => {
  const stages = []
  const reporter = createInstallStageReporter({ onStage: stage => stages.push(stage), onProgress() {}, now: () => 1, heartbeatMs: 0 })
  reporter.push(Buffer.from('== [步骤 4] 启动 3088 酒馆服务（已用 9s）==', 'utf8'))
  assert.deepEqual(stages, [])
  reporter.end()
  assert.deepEqual(stages, ['第 4 步 · 启动 3088 酒馆服务'])
})
