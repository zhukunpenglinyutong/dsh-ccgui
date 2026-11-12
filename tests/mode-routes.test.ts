import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { modeHandler } from '../src/mode-routes.ts'
import type { ModeRoutes } from '../src/mode-routes.ts'
import type { CliModeList } from '../src/model-options.ts'

const MODES: CliModeList = {
  configId: 'permission_mode',
  current: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'plan', name: 'Plan' },
  ],
}

interface Captured {
  status: number
  headers: Record<string, string>
  body: string
}

function requestOf(body: unknown, { method = 'POST' }: { method?: string } = {}): IncomingMessage {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const stream = Readable.from([Buffer.from(text)])
  return Object.assign(stream, { method, headers: {}, url: '/dsh-ccgui/modes' }) as unknown as IncomingMessage
}

function responseOf(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead: (status: number, headers: Record<string, string> = {}) => {
      captured.status = status
      captured.headers = headers
    },
    end: (chunk?: string) => {
      captured.body = chunk ?? ''
    },
  } as unknown as ServerResponse
  return { res, captured }
}

interface Options {
  routes?: Partial<ModeRoutes>
  rejection?: 401 | 403
  warn?: (message: string) => void
}

async function post(body: unknown, options: Options = {}): Promise<Captured & { routes: ModeRoutes }> {
  const routes: ModeRoutes = {
    modeState: vi.fn(() => ({ modes: MODES })),
    switchMode: vi.fn(() => Promise.resolve(MODES)),
    ...options.routes,
  }
  const connection = { requestRejection: () => options.rejection }
  const handler = modeHandler(routes, connection, options.warn ?? (() => undefined))
  const { res, captured } = responseOf()
  await handler(requestOf(body), res)
  return { ...captured, routes }
}

const json = (captured: Captured): Record<string, unknown> => JSON.parse(captured.body) as Record<string, unknown>

describe('mode route', () => {
  it('refuses a request the connection rejects', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-x' }, { rejection: 403 })
    expect(result.status).toBe(403)
    expect(json(result)).toEqual({ success: false, error: '未授权' })
    expect(result.routes.modeState).not.toHaveBeenCalled()
  })

  it('takes POST only', async () => {
    const routes: ModeRoutes = { modeState: vi.fn(), switchMode: vi.fn() }
    const handler = modeHandler(routes, { requestRejection: () => undefined }, () => undefined)
    const { res, captured } = responseOf()
    await handler(requestOf('{}', { method: 'GET' }), res)
    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe('POST')
  })

  it('rejects a body that is not JSON', async () => {
    const result = await post('{not json')
    expect(result.status).toBe(400)
    expect(json(result)).toMatchObject({ success: false })
  })

  it('rejects a body without a session or a CLI', async () => {
    const result = await post({ provider: 'cli-x' })
    expect(result.status).toBe(400)
    expect(json(result)).toEqual({ success: false, error: '请求缺少会话或 CLI' })
  })

  it('rejects a mode that is not a string', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-x', mode: 3 })
    expect(result.status).toBe(400)
  })

  it('refuses more than a request this size', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-x', mode: 'x'.repeat(9_000) })
    expect(result.status).toBe(413)
    expect(json(result)).toEqual({ success: false, error: '请求内容过大' })
  })

  it('only reads when no mode is given', async () => {
    const result = await post(
      { sessionId: 'dsh-1', provider: 'cli-x' },
      { routes: { modeState: () => ({ modes: MODES, pending: 'plan' }) } },
    )
    expect(result.status).toBe(200)
    expect(result.routes.switchMode).not.toHaveBeenCalled()
    expect(json(result)).toEqual({ success: true, data: { modes: MODES, pending: 'plan' } })
  })

  it('sends the pick through unchanged and answers with what the CLI reports', async () => {
    const switched = { ...MODES, current: 'plan' }
    const result = await post(
      { sessionId: 'dsh-1', provider: 'cli-x', mode: 'plan' },
      {
        routes: {
          switchMode: vi.fn(() => Promise.resolve(switched)),
          modeState: () => ({ modes: switched }),
        },
      },
    )
    expect(result.routes.switchMode).toHaveBeenCalledWith('dsh-1', 'cli-x', 'plan')
    expect(json(result)).toEqual({ success: true, data: { modes: switched, pending: null } })
  })

  it('answers with nulls when the CLI reports no modes', async () => {
    const result = await post({ sessionId: 'dsh-1', provider: 'cli-x' }, { routes: { modeState: () => ({}) } })
    expect(json(result)).toEqual({ success: true, data: { modes: null, pending: null } })
  })

  it('passes a refusal the user can act on', async () => {
    const warn = vi.fn()
    const refusal = new LlmError('这个 CLI 没有报告模式 plan。', 'CLI_MODE_FAILED')
    const result = await post(
      { sessionId: 'dsh-1', provider: 'cli-x', mode: 'plan' },
      { routes: { switchMode: () => Promise.reject(refusal) }, warn },
    )
    expect(result.status).toBe(400)
    expect(json(result)).toEqual({ success: false, error: '这个 CLI 没有报告模式 plan。' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps an unexpected failure out of the answer and logs it', async () => {
    const warn = vi.fn()
    const result = await post(
      { sessionId: 'dsh-1', provider: 'cli-x', mode: 'plan' },
      { routes: { switchMode: () => Promise.reject(new Error('socket closed')) }, warn },
    )
    expect(result.status).toBe(500)
    expect(json(result)).toEqual({ success: false, error: '切换模式失败，请查看日志' })
    expect(warn).toHaveBeenCalledWith('ccgui: mode request failed: socket closed')
  })
})
