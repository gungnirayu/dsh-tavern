#!/usr/bin/env node
// 供 build-offline-bundle.sh 调用：用打包含酒馆源码自身的 mergeProfileManifest，
// 生成与手机首装完全一致的 tavern Profile package.json（宿主 android、DSH 0.2.0-rc.2），
// 使离线采集 store 时拿到与真机相同的依赖集合（含 hostLinePackages 0.2.0 线的钉版）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const [work, sourceDirArg = '', host = 'android', dshVersion = '0.2.0-rc.2'] = process.argv.slice(2)
if (!work) {
  console.error('用法：render-tavern-profile.mjs <work-dir> [source-dir] [host] [dshVersion]')
  process.exit(2)
}
const sourceRoot = sourceDirArg ? path.resolve(sourceDirArg) : path.join(work, 'source')
const { mergeProfileManifest } = await import(pathToFileURL(path.join(sourceRoot, 'bin', 'profile-configuration.mjs')).href)
const { hostLinePackages } = await import(pathToFileURL(path.join(sourceRoot, 'bin', 'dsh-compatibility.mjs')).href)
const source = JSON.parse(readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))
if (!hostLinePackages(dshVersion)?.['dsh-better-sidebar']) {
  throw new Error(`hostLinePackages(${dshVersion}) 缺少 dsh-better-sidebar 钉版，请核对采集配置`)
}
const manifest = mergeProfileManifest({
  source,
  current: {},
  pluginPath: path.join(sourceRoot, 'tavern-plugin'),
  dataRoot: path.join(work, 'tavern-data'),
  host,
  dshVersion,
})
const profileDir = path.join(work, 'tavern-profile')
mkdirSync(profileDir, { recursive: true })
writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(path.join(profileDir, 'package.json'))
