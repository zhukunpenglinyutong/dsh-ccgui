import { describe, expect, it, vi } from 'vitest'
import { createModeApi, modeApiFor } from '../../src/client/mode-api.ts'
import type { PostJson } from '../../src/client/mode-api.ts'
import { MODE_ROUTE_PREFIX } from '../../src/constants.ts'

const MODES = {
  configId: 'permission_mode',
  current: 'plan',
  options: [{ value: 'plan', name: 'Plan' }],
}

function poster(body: unknown, { ok = true, status = 200 } = {}): PostJson {
  return vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as unknown as Response))
}

const bodyOf = (init: RequestInit): Record<string, unknown> =>
  typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

/** Stands in for a request the route was never asked to make. */
const NOTHING: [string, RequestInit] = ['', {}]

const sent = (post: PostJson): { url: string; method: string; body: Record<string, unknown> } => {
  const [url, init] = vi.mocked(post).mock.calls[0] ?? NOTHING
  return { url, method: init.method ?? '', body: bodyOf(init) }
}

describe('mode API', () => {
  it('reads with the session and the CLI route only', async () => {
    const post = poster({ success: true, data: { modes: MODES, pending: null } })
    await expect(createModeApi(post, 'dsh-1').read('cli-x')).resolves.toEqual({ modes: MODES, pending: undefined })
    const request = sent(post)
    expect(request.url).toBe(MODE_ROUTE_PREFIX)
    expect(request.method).toBe('POST')
    expect(request.body).toEqual({ sessionId: 'dsh-1', provider: 'cli-x' })
  })

  it('sends the id it was given, unchanged', async () => {
    const post = poster({ success: true, data: { modes: MODES, pending: null } })
    await createModeApi(post, 'dsh-1').write('cli-x', 'plan')
    expect(sent(post).body).toEqual({ sessionId: 'dsh-1', provider: 'cli-x', mode: 'plan' })
  })

  it('reports a pending pick', async () => {
    const post = poster({ success: true, data: { modes: MODES, pending: 'plan' } })
    await expect(createModeApi(post, 'dsh-1').read('cli-x')).resolves.toEqual({ modes: MODES, pending: 'plan' })
  })

  it('reads a CLI with no modes as having none', async () => {
    const post = poster({ success: true, data: { modes: null, pending: null } })
    await expect(createModeApi(post, 'dsh-1').read('cli-x')).resolves.toEqual({
      modes: undefined,
      pending: undefined,
    })
  })

  it('drops options that are not a mode', async () => {
    const post = poster({
      success: true,
      data: { modes: { ...MODES, options: [null, { value: 'plan' }, { value: 'plan', name: 'Plan' }] }, pending: null },
    })
    await expect(createModeApi(post, 'dsh-1').read('cli-x')).resolves.toMatchObject({
      modes: { options: [{ value: 'plan', name: 'Plan' }] },
    })
  })

  it('passes on the reason the route refused', async () => {
    const post = poster({ success: false, error: '这个 CLI 没有报告模式 plan。' })
    await expect(createModeApi(post, 'dsh-1').write('cli-x', 'plan')).rejects.toThrow('这个 CLI 没有报告模式 plan。')
  })

  it('reports an HTTP failure', async () => {
    const post = poster({}, { ok: false, status: 500 })
    await expect(createModeApi(post, 'dsh-1').read('cli-x')).rejects.toThrow('HTTP 500')
  })

  it('refuses a reply it cannot read', async () => {
    await expect(createModeApi(poster({ success: 'yes' }), 'dsh-1').read('cli-x')).rejects.toThrow('切换 CLI 模式失败')
    await expect(createModeApi(poster(null), 'dsh-1').read('cli-x')).rejects.toThrow('模式接口')
  })

  // A control reads in an effect, so a fresh object per render would make it read again
  // each time round: the same session must be handed the same API.
  it('hands the same session the same API', async () => {
    const post = poster({ success: true, data: { modes: MODES, pending: null } })
    const first = modeApiFor(post, 'dsh-2')
    expect(modeApiFor(post, 'dsh-2')).toBe(first)
    await first.read('cli-x')
    expect(sent(post).body).toEqual({ sessionId: 'dsh-2', provider: 'cli-x' })
  })

  it('keeps sessions apart', () => {
    const post = poster({ success: true, data: { modes: MODES, pending: null } })
    expect(modeApiFor(post, 'dsh-3')).not.toBe(modeApiFor(post, 'dsh-4'))
  })
})
