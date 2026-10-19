import assert from 'node:assert/strict'
import { join } from 'node:path'

// A message panel with scripts pinned to the right must actually appear there,
// whichever sidebar tab is showing and wherever the status bar is placed.
export async function pinPanelChecks({ page, step, output, report }) {
  // The visible frame showing the panel, inside or outside the right sidebar.
  async function shown(inSidebar) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue
        const element = await frame.frameElement().catch(() => null)
        if (!element || !await element.isVisible() || await element.getAttribute('aria-hidden') === 'true') continue
        if (!await frame.locator('#e2e-display-fenced').count()) continue
        if (await element.evaluate(node => Boolean(node.closest('.dsh-tavern-status-runtime'))) === inSidebar) return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw Error(inSidebar ? '固定后右侧没有显示该面板' : '返回后正文里没有显示该面板')
  }
  const pin = page.getByRole('button', { name: '固定到右侧', exact: true }).filter({ visible: true }).first()
  const back = page.getByRole('button', { name: '返回正文栏', exact: true }).filter({ visible: true })
  const results = {}
  async function attempt(name, prepare) {
    await step(name, async () => {
      await prepare()
      await pin.click()
      await shown(true)
      await page.screenshot({ path: join(output, 'pin-' + Object.keys(results).length + '.png'), fullPage: true })
      await back.click()
      await shown(false)
      results[name] = true
    })
  }
  await attempt('酒馆状态打开时固定面板显示在右侧', async () => {
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
  })
  await attempt('右侧停在其他标签时固定面板也显示在右侧', async () => {
    await page.getByText('本局设置', { exact: true }).filter({ visible: true }).first().click()
  })
  await attempt('状态栏放在正文下方时固定面板仍显示在右侧', async () => {
    await page.getByText('本局设置', { exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('combobox', { name: '状态栏位置' }).selectOption('body')
    await page.waitForTimeout(1000)
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
  })
  report.pinPanel = results
}
