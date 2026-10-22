// Real Chromium + React mount of the bundled image prompt editor.
// Run explicitly: node tests/browser/bundled-image-prompt-editor-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const clientSource = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')

function declaration(name) {
  const ast = parse(clientSource, { ecmaVersion: 'latest', sourceType: 'script' })
  let found
  function visit(node) {
    if (!node || found) return
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = node; return }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  }
  visit(ast)
  if (!found) throw new Error(`Missing bundled client function ${name}`)
  return clientSource.slice(found.start, found.end)
}

const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(7000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() })

  const promptText = [
    '<scene_composition>two people in a garden</scene_composition>',
    '<character_1><prompt>first character</prompt><uc>bad face</uc></character_1>',
    '<character_2><prompt>second character</prompt><uc>extra fingers</uc></character_2>',
  ].join('\n')
  const componentScript = [
    'const React=modules.react; const useEffect=React.useEffect, useState=React.useState;',
    'const BASE="http://localhost/plugins/dsh-tavern-image"; let openPromptEditor=null;',
    'const mediaPostLocks=new Set(), mediaUncertainActions=new Set(), requests=[];',
    'const validMediaContext=context=>Boolean(context&&context.gameId&&context.mediaId&&context.jobId&&context.textVersion&&Number.isFinite(Number(context.turn)));',
    `async function jsonFetch(url,options={}) {
      if(url.includes('/job-detail?')) return {ok:true,job:{rawPrompt:'two people in a garden',tag:'two people in a garden',prompt:'expanded',promptText:${JSON.stringify(promptText)},negative:'base uc'}};
      if(url.endsWith('/state')) return {config:{imageChannels:[]}};
      if(url.endsWith('/media-action')) { requests.push(JSON.parse(options.body)); return {ok:true,jobId:'replacement'}; }
      throw new Error('unexpected request');
    }`,
    'function reportHost(){}; const redrawnJobs=new Map(); function persistRedraw(){}; const lastSessionId="game";',
    declaration('openEditorFor'),
    declaration('PromptEditor'),
    'const root=modules["react-dom/client"].createRoot(document.querySelector("#root")); root.render(React.createElement(PromptEditor));',
    'window.__openEditor=(jobId,context)=>openEditorFor(jobId,"title",context); window.__requests=requests;',
  ].join('\n')
  await page.addScriptTag({ content: componentScript })
  await page.evaluate(() => window.__openEditor('job-1', {
    gameId: 'game', turn: 3, textVersion: 'v3', mediaId: 'media-1', jobId: 'job-1',
  }))

  const prompt = page.locator('textarea').first()
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('<character_2>'))
  await prompt.fill('<scene_composition>two people in a garden, clear role list</scene_composition>')
  await page.getByRole('button', { name: /用这段重画/ }).click()
  await page.waitForFunction(() => window.__requests.length === 1)

  const request = await page.evaluate(() => window.__requests[0])
  assert.equal(request.operation, 'redraw')
  assert.equal(request.prompt, '<scene_composition>two people in a garden, clear role list</scene_composition>')
  assert.deepEqual(pageErrors, [], 'browser runtime reports no uncaught errors')
  console.log('PASS Chromium bundled React prompt editor: loads structured roles and sends a scene-only redraw after clearing all role blocks')
} finally {
  await browser.close()
}
