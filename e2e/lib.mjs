// Drives the real DSH Web UI. Results are judged from files and the session log,
// because status labels stay in the DOM after a turn has moved on.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

export const E2E_ROOT = process.env.E2E_ROOT ?? '/tmp/dsh-ccgui-e2e'
export const WORKSPACE = join(E2E_ROOT, 'docs/deepseek-harness/default-workspace')
const SESSIONS = join(E2E_ROOT, 'home/sessions')
const DSH_REPO = process.env.DSH_REPO
if (DSH_REPO === undefined) throw new Error('set DSH_REPO to a built deepseek-harness checkout')

function serverUrl() {
  const urls = readFileSync(join(E2E_ROOT, 'server.log'), 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g)
  if (urls === null) throw new Error('server URL not found; is e2e/start-server.sh running?')
  return urls.at(-1)
}

async function launch() {
  const require = createRequire(join(DSH_REPO, 'packages/experimental/inspector/package.json'))
  const { chromium } = require('playwright')
  const executablePath = process.env.CHROMIUM_PATH
  return chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) })
}

async function dismissDialogs(page) {
  for (let i = 0; i < 4; i += 1) {
    const button = page
      .locator('[role=presentation]')
      .getByRole('button', { name: /继续|开始|知道了|完成|跳过/ })
      .first()
    if (!(await button.isVisible().catch(() => false))) return
    await button.click()
    await page.waitForTimeout(500)
  }
}

/**
 * Open the UI and return the helpers scenarios use.
 * @returns the page, its helpers, and a reporter.
 */
export async function openHarness() {
  const browser = await launch()
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await page.goto(serverUrl())
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await dismissDialogs(page)
  await page.waitForTimeout(1000)

  const sleep = (ms) => page.waitForTimeout(ms)
  const bodyText = () => page.evaluate(() => document.body.innerText)
  const shot = (name) => page.screenshot({ path: join(E2E_ROOT, `${name}.png`) })

  async function until(check, label, timeout = 20_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await check()) return
      await sleep(200)
    }
    throw new Error(`timed out waiting for ${label}`)
  }

  async function newSession(preset) {
    await page.getByRole('button', { name: '新建会话' }).last().click()
    await sleep(700)
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
    await sleep(400)
    const name = new RegExp(preset)
    await page
      .getByRole('menuitemradio', { name })
      .or(page.getByRole('menuitem', { name }))
      .or(page.getByRole('option', { name }))
      .first()
      .click()
    await sleep(500)
  }

  const cliSwitcher = () => page.getByRole('button', { name: '切换 CLI' })

  /** Put the open session on a CLI with the composer's switcher. */
  async function chooseCli(name) {
    await until(() => cliSwitcher().isVisible(), 'CLI switcher')
    if ((await cliSwitcher().innerText()).trim() === name) return
    await cliSwitcher().click()
    await sleep(300)
    await page
      .getByRole('menuitem', { name, exact: true })
      .or(page.getByRole('menuitemradio', { name, exact: true }))
      .first()
      .click()
    await until(async () => (await cliSwitcher().innerText()).trim() === name, `switcher showing ${name}`)
  }

  /** Start a standard session and put it on a CLI with the composer's switcher. */
  async function newCliSession(name) {
    await newSession('标准模式')
    await chooseCli(name)
  }

  const modelTrigger = () => page.getByRole('button', { name: /^(选择模型|请选择模型)/ }).last()

  /** Escape only steps back a level in this menu, so repeat until it has closed. */
  async function closeModelMenu() {
    for (let i = 0; i < 3 && (await modelTrigger().getAttribute('aria-expanded')) === 'true'; i += 1) {
      await page.keyboard.press('Escape')
      await sleep(250)
    }
  }

  async function openModelList() {
    await closeModelMenu()
    await modelTrigger().click()
    await sleep(300)
    const drill = page.getByRole('menuitem', { name: /^模型/ }).first()
    if (await drill.isVisible().catch(() => false)) await drill.click()
    await page.getByRole('menuitemradio').first().waitFor({ timeout: 10_000 })
    await sleep(300)
  }

  /** Read the names a CLI's group lists. */
  async function modelNames(cli) {
    await openModelList()
    const names = await page
      .getByRole('group', { name: cli, exact: true })
      .getByRole('menuitemradio')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('title')))
    await closeModelMenu()
    return names
  }

  /** Pick a model, waiting for the list because a CLI reports it after starting up. */
  async function chooseModel(cli, name, timeout = 180_000) {
    await until(async () => (await modelNames(cli)).includes(name), `model ${name}`, timeout)
    await openModelList()
    // A row's accessible name also contains the small print beside its name (a CLI's
    // cost multiplier), so match on the title: the same name modelNames() reports.
    await page
      .getByRole('group', { name: cli, exact: true })
      .locator(`[role="menuitemradio"][title=${JSON.stringify(name)}]`)
      .click()
    await sleep(500)
  }

  /** Reopen a session from the sidebar, which unfolds a few older ones per click. */
  async function openSession(text) {
    const more = page.getByText(/展开其余/).first()
    while (await more.isVisible().catch(() => false)) {
      await more.click()
      await sleep(300)
    }
    await page.getByText(text).first().click()
    await sleep(2000)
  }

  async function send(text) {
    await page.locator('[contenteditable=true]').first().click()
    await page.keyboard.type(text)
    await page.getByRole('button', { name: '发送消息' }).click()
  }

  const settingsDialog = () => page.locator('[data-shortcut-modal="settings"]')

  /** The page is a section of the harness's Settings dialog, reached from the account menu. */
  async function openCcguiSettings() {
    if (!(await settingsDialog().isVisible())) {
      await page.getByRole('button', { name: '账号菜单' }).click()
      await page.getByRole('menuitem', { name: /^设置/ }).click()
      await until(() => settingsDialog().isVisible(), 'settings dialog')
    }
    await settingsDialog().getByRole('button', { name: 'CC GUI 设置' }).click()
  }

  async function closeSettings() {
    for (let i = 0; i < 3 && (await settingsDialog().isVisible()); i += 1) {
      await page.keyboard.press('Escape')
      await sleep(300)
    }
    if (await settingsDialog().isVisible()) throw new Error('the settings dialog did not close')
  }

  const results = []
  async function scenario(name, run) {
    const before = errors.length
    try {
      await run()
      if (errors.length > before) throw new Error(`browser errors: ${errors.slice(before).join(' | ')}`)
      results.push(['PASS', name])
    } catch (error) {
      results.push(['FAIL', name, String(error.message).slice(0, 300)])
      await shot(`fail-${name.split(':')[0]}`)
    }
  }

  async function finish() {
    for (const [status, name, detail] of results) console.log(status, name, detail ?? '')
    const failed = results.filter(([status]) => status === 'FAIL').length
    console.log(`\n${results.length - failed}/${results.length} passed`)
    await browser.close()
    process.exit(failed === 0 ? 0 : 1)
  }

  return {
    page,
    sleep,
    bodyText,
    shot,
    until,
    newSession,
    newCliSession,
    chooseCli,
    cliSwitcher,
    modelTrigger,
    modelNames,
    chooseModel,
    openSession,
    openCcguiSettings,
    closeSettings,
    send,
    scenario,
    finish,
  }
}

/**
 * Read a session log as text. DSH appends each batch as its own zstd frame, and neither
 * the sync nor the streaming decompressor reads past the first one, so the log is split
 * on the frame magic and each frame is decoded on its own.
 * @param file - the log's file name, which says whether it is compressed.
 * @param raw - the file's bytes.
 * @returns the whole log.
 */
function readLog(file, raw) {
  if (!file.endsWith('.zstd')) return raw.toString()
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const frames = []
  let start = raw.indexOf(magic)
  while (start !== -1) {
    const next = raw.indexOf(magic, start + magic.length)
    frames.push(zstdDecompressSync(raw.subarray(start, next === -1 ? raw.length : next)))
    start = next
  }
  return Buffer.concat(frames).toString()
}

/**
 * Read the log of the session whose text contains a prompt.
 * @param prompt - text identifying the session.
 * @returns its events, or an empty list.
 */
export function sessionEvents(prompt) {
  if (!existsSync(SESSIONS)) return []
  for (const group of readdirSync(SESSIONS)) {
    for (const id of readdirSync(join(SESSIONS, group))) {
      const dir = join(SESSIONS, group, id)
      const file = readdirSync(dir).find((name) => name.startsWith('session') && name.includes('jsonl'))
      if (file === undefined) continue
      const text = readLog(file, readFileSync(join(dir, file)))
      if (text.includes(prompt))
        return text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
    }
  }
  return []
}

/**
 * Read a session's finished turns.
 * @param prompt - text identifying the session.
 * @returns its `turn/end` events.
 */
export const turnEnds = (prompt) => sessionEvents(prompt).filter((event) => event.type === 'turn/end')

/**
 * Read the CLI session ids a harness session recorded.
 * @param prompt - text identifying the session.
 * @returns the distinct native session ids.
 */
export const nativeSessionIds = (prompt) => [
  ...new Set(
    sessionEvents(prompt)
      .filter((event) => event.type === 'assistant/message')
      .map((event) => event.data.message?.source?.replayState?.response?.acpSessionId)
      .filter(Boolean),
  ),
]
