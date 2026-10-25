import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyHostVersion } from '../tavern-plugin/lib/domain/host-compatibility.js'

const policy = { minDshVersion: '0.2.0-rc.2', belowDshVersion: '0.3.0', blockedDshVersions: ['0.2.1-rc.4'] }

test('运行时按支持范围：范围内不提示，范围外、黑名单与读取失败标为不可用并提示', () => {
  for (const version of ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.0-rc.2']) {
    assert.equal(classifyHostVersion(version, policy).status, 'allowed', version)
    assert.equal(classifyHostVersion(version, policy).message, '')
  }
  for (const version of ['0.2.0-rc.1', '0.2.1-rc.4', '0.3.0', '0.1.5-rc.2', '']) {
    const result = classifyHostVersion(version, policy)
    assert.equal(result.status, 'blocked', version)
    assert.match(result.message, /支持的版本：0\.2\.0-rc\.2 ≤ 版本 < 0\.3\.0/)
  }
})
