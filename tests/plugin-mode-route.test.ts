import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WAIT, addAgent, harness, load, start, stopStarted } from './fixtures/plugin-harness.ts'
import type { Harness } from './fixtures/plugin-harness.ts'

// The fallback probe directory lives under the user's home; point it at a scratch
// directory so the suite never writes to the real one.
const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>()
  return { ...actual, homedir: () => home.dir }
})

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'ccgui-user-'))
})

afterEach(stopStarted)

describe('CliBridge mode route', () => {
  interface Route {
    readonly kind: string
    readonly path: string
    handler(req: IncomingMessage, res: ServerResponse): Promise<void>
  }

  function requestOf(body: unknown): IncomingMessage {
    return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: 'POST',
      headers: {},
      url: '/dsh-ccgui/modes',
    }) as unknown as IncomingMessage
  }

  function responseOf(): { res: ServerResponse; answer: () => Record<string, unknown> } {
    let body = ''
    const res = {
      writeHead: () => undefined,
      end: (chunk?: string) => {
        body = chunk ?? ''
      },
    } as unknown as ServerResponse
    return { res, answer: () => JSON.parse(body) as Record<string, unknown> }
  }

  async function modeRoute(h: Harness, dispose: () => void = vi.fn()): Promise<Route> {
    const routes: Route[] = []
    h.root.provide('webServer', {
      register: (route: Route) => {
        routes.push(route)
        return dispose
      },
    })
    h.root.provide('connection', { requestRejection: () => undefined })
    await vi.waitFor(() => {
      expect(routes.map((route) => route.path)).toEqual(['/dsh-ccgui/git', '/dsh-ccgui/modes'])
    })
    return routes[1] as Route
  }

  async function post(route: Route, body: unknown): Promise<Record<string, unknown>> {
    const { res, answer } = responseOf()
    await route.handler(requestOf(body), res)
    return answer()
  }

  // Before any list is known there is nothing a pick could be checked against, and the
  // control does not render; a direct call must not plant an id the CLI never offered.
  it('serves the CLI mode route beside the git routes, and refuses a pick before any list is known', async () => {
    const h = harness()
    const dispose = vi.fn()
    const fiber = await load(h)
    const modes = await modeRoute(h, dispose)

    await expect(post(modes, { sessionId: 'dsh-1', provider: 'cli-fake' })).resolves.toEqual({
      success: true,
      data: { modes: null, pending: null },
    })
    await expect(post(modes, { sessionId: 'dsh-1', provider: 'cli-fake', mode: 'plan' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('还没有读到') as unknown,
    })

    await fiber.dispose()
    expect(dispose).toHaveBeenCalled()
  })

  it('holds a pick the CLI offers until it starts, and refuses one it never offered', async () => {
    const h = harness()
    await start(h)
    const { agent } = addAgent(h, { preset: 'cli-fake' })
    await h.root.serial('agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake']), WAIT)
    const modes = await modeRoute(h)

    await expect(post(modes, { sessionId: 'dsh-1', provider: 'cli-fake', mode: 'plan' })).resolves.toMatchObject({
      success: true,
      data: { modes: { configId: 'mode', current: 'default' }, pending: 'plan' },
    })
    await expect(post(modes, { sessionId: 'dsh-1', provider: 'cli-fake', mode: 'yolo' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('yolo') as unknown,
    })
    // The refused id did not replace the pick that is waiting.
    await expect(post(modes, { sessionId: 'dsh-1', provider: 'cli-fake' })).resolves.toMatchObject({
      data: { pending: 'plan' },
    })
  })
})
