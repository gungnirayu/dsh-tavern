// Real Chromium + React mount of the delegated image gallery and legacy image renderer.
// Run explicitly: node tests/browser/scene-image-delegation-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const features = new URL('../../tavern-plugin/src/client/features/', import.meta.url)
const gallerySource = await readFile(new URL('scene-images.js', features), 'utf8')
const rendererSource = await readFile(new URL('assistant-renderer.js', features), 'utf8')

function declaration(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
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
  if (!found) throw new Error(`Missing source function ${name}`)
  return source.slice(found.start, found.end)
}

const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/dsh-tavern/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#789"/></svg>'
  }))
  await page.setContent('<!doctype html><meta charset="utf-8"><main><div id="gallery"></div><div id="legacy"></div></main>')
  await page.addScriptTag({ content: await browserReactScript() })
  const componentScript = [
    'const React=modules.react;',
    declaration(gallerySource, 'SceneImageGallery'),
    declaration(rendererSource, 'SceneIllustration'),
    `
      const galleryRoot=modules['react-dom/client'].createRoot(document.querySelector('#gallery'));
      const legacyRoot=modules['react-dom/client'].createRoot(document.querySelector('#legacy'));
      const pending=[], calls=[];
      window.__rpc=(method,args,sessionId)=>{
        if(method==='listSceneImageHistory') return new Promise(resolve=>pending.push({sessionId:sessionId||args.sessionId,resolve}));
        calls.push({method,args,sessionId});
        if(method==='removeSceneImageHistory') return Promise.resolve({results:(args.pluginItems||[]).map(id=>({versionId:id,ok:true}))});
        return Promise.resolve({});
      };
      function rpc(method,args,sessionId){return window.__rpc(method,args,sessionId);}
      function useTavernConfirm(){return async()=>true;}
      const tavernPluginMediaIndex={subscribe:()=>()=>{}};
      const openSceneImagePreview=()=>{};
      const DshUi={IconTrashOutlineRegular:'trash-icon'};
      const useSceneImageRecord=()=>null;
      const sceneImageStageLabel=()=>'';
      const sceneImageRequestId=()=> 'unused';
      const sceneImagePurchaseConfirmation=async()=>undefined;
      const recordImageInteraction=()=>{};
      const SceneImagePending='pending';
      window.__pending=pending; window.__calls=calls;
      window.__setGallerySession=sessionId=>galleryRoot.render(React.createElement(SceneImageGallery,{gallerySessionId:sessionId}));
      window.__setGallerySession('A');
      legacyRoot.render(React.createElement(SceneIllustration,{sessionId:'B',turn:1,canAdd:false,record:{
        enabled:false,key:'legacy-key',status:'ready',versions:[{id:'legacy-v1',description:'legacy illustration',createdAt:1}],
        reference:{bindings:[],supported:false,warning:''},profile:'legacy'
      }}));
    `
  ].join('\n')
  await page.addScriptTag({ content: componentScript })

  await page.waitForFunction(() => window.__pending.some(request => request.sessionId === 'A'))
  await page.evaluate(() => window.__setGallerySession('B'))
  await page.waitForFunction(() => window.__pending.some(request => request.sessionId === 'B'))
  await page.evaluate(() => {
    const request = window.__pending.find(item => item.sessionId === 'B')
    request.resolve({
      items: [{ chatId: 'chat-B', key: 'native-key', turn: 1, versions: [{ id: 'native-B', description: 'old native image', createdAt: 1 }] }],
      pluginItems: [{ id: 'plugin-B', turn: 1, caption: 'delegated plugin image', createdAt: 2, updatedAt: 3 }]
    })
  })
  await page.locator('#gallery img').nth(1).waitFor()
  await page.evaluate(() => {
    window.__pending.find(item => item.sessionId === 'A').resolve({
      items: [{ chatId: 'chat-A', key: 'native-A', turn: 1, versions: [{ id: 'native-A', description: 'A image', createdAt: 1 }] }],
      pluginItems: [{ id: 'plugin-A', turn: 1, caption: 'A plugin image', createdAt: 2 }]
    })
  })
  await page.waitForTimeout(50)

  const gallerySources = await page.locator('#gallery img').evaluateAll(images => images.map(image => image.getAttribute('src')))
  assert.equal(gallerySources.length, 2, 'gallery renders both native and delegated plugin pictures')
  assert.ok(gallerySources.some(src => src.includes('scene-image-stored') && src.includes('native-B')))
  assert.ok(gallerySources.some(src => src.includes('plugin-B')))
  assert.ok(gallerySources.every(src => !src.includes('A-')), 'late response from A cannot replace B')
  assert.equal(await page.locator('#legacy img[alt="本段场景插画"]').count(), 1, 'disabled native renderer keeps the old image visible')
  for (const label of ['重画', '改提示词', '新增插图', '同方案重画']) assert.equal(await page.locator('#legacy button').filter({ hasText: label }).count(), 0)
  assert.equal(await page.locator('#legacy button').count(), 0, 'legacy native picture card is read-only; deletion lives in the gallery')

  const nativeFigure = page.locator('#gallery figure[title="old native image"]')
  await nativeFigure.getByRole('button', { name: '删除这张图片' }).click()
  await page.waitForFunction(() => window.__calls.some(call => call.method === 'removeSceneImageHistory'))
  const nativeDeletion = await page.evaluate(() => window.__calls.find(call => call.method === 'removeSceneImageHistory'))
  assert.equal(nativeDeletion.sessionId, 'B')
  assert.deepEqual(Array.from(nativeDeletion.args.items), [{ chatId: 'chat-B', key: 'native-key', versionId: 'native-B' }])
  assert.deepEqual(Array.from(nativeDeletion.args.pluginItems), [])

  const pluginFigure = page.locator('#gallery figure[title="delegated plugin image"]')
  await pluginFigure.getByRole('button', { name: '删除这张图片' }).click()
  await page.waitForFunction(() => window.__calls.filter(call => call.method === 'removeSceneImageHistory').length >= 2)
  const deletion = await page.evaluate(() => window.__calls.filter(call => call.method === 'removeSceneImageHistory')[1])
  assert.equal(deletion.sessionId, 'B')
  assert.equal(deletion.args.sessionId, 'B')
  assert.deepEqual(Array.from(deletion.args.pluginItems), ['plugin-B'])
  assert.deepEqual(Array.from(deletion.args.items), [])
  assert.deepEqual(pageErrors, [], 'browser runtime reports no uncaught errors')
  console.log('PASS Chromium scene image delegation smoke: legacy and plugin images, session isolation, scoped plugin deletion, no page errors')
} finally {
  await browser.close()
}
