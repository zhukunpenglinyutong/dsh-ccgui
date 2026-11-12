// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The composer's CLI mode control, exercised through its public export. The list it shows is
 * the CLI's own: these tests only check that ids and names pass through untouched and that
 * the control stays out of the way when the CLI reports no modes.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModeApi, ModeReply } from '../../src/client/mode-api.ts'
import { MODE_POLL_MS, MODE_POLL_TRIES, ModeMenu } from '../../src/client/mode-menu.tsx'

const MODES = {
  configId: 'permission_mode',
  current: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'acceptEdits', name: 'Accept Edits' },
    { value: 'plan', name: 'Plan' },
  ],
}

const ANSWER: ModeReply = { modes: MODES, pending: undefined }
const NO_MODES: ModeReply = { modes: undefined, pending: undefined }

interface Setup {
  readonly read: ReturnType<typeof vi.fn<ModeApi['read']>>
  readonly write: ReturnType<typeof vi.fn<ModeApi['write']>>
  readonly user: ReturnType<typeof userEvent.setup>
}

function setup({
  reply = ANSWER,
  read = () => Promise.resolve(reply),
  write = () => Promise.resolve(ANSWER),
  locked = false,
  started = true,
  provider = 'cli-x',
}: {
  reply?: ModeReply
  read?: ModeApi['read']
  write?: ModeApi['write']
  locked?: boolean
  started?: boolean
  provider?: string | undefined
} = {}): Setup {
  const reading = vi.fn<ModeApi['read']>(read)
  const written = vi.fn<ModeApi['write']>(write)
  render(
    <div data-composer-card>
      <ModeMenu provider={provider} api={{ read: reading, write: written }} locked={locked} started={started} />
    </div>,
  )
  return { read: reading, write: written, user: userEvent.setup() }
}

const trigger = async (): Promise<HTMLElement> => screen.findByRole('button', { name: /CLI 模式/ })

afterEach(cleanup)

describe('ModeMenu', () => {
  it('shows the mode the CLI is on', async () => {
    setup()
    expect((await trigger()).getAttribute('aria-label')).toBe('CLI 模式，当前 Default')
  })

  it('stays out of the way when the session has no CLI route', () => {
    const { container } = render(
      <ModeMenu provider={undefined} api={{ read: vi.fn(), write: vi.fn() }} locked={false} started />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('stays out of the way when no mode route is offered', () => {
    const { container } = render(<ModeMenu provider="cli-x" api={undefined} locked={false} started />)
    expect(container.innerHTML).toBe('')
  })

  it('stays out of the way when the CLI reports no modes', async () => {
    const { read } = setup({ reply: NO_MODES })
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
  })

  it('stays out of the way when the CLI reports an empty list', async () => {
    const { read } = setup({ reply: { modes: { ...MODES, options: [] }, pending: undefined } })
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
  })

  it('stays out of the way when the route cannot be read', async () => {
    const { read } = setup({ read: () => Promise.reject(new Error('boom')) })
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
  })

  it('lists the modes in the CLI order and marks the current one', async () => {
    const { user } = setup()
    await user.click(await trigger())
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(['Default', 'Accept Edits', 'Plan'])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
  })

  it('asks the route again each time the menu opens', async () => {
    const { read, user } = setup()
    await user.click(await trigger())
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledWith('cli-x')
  })

  it('sends the id the CLI reported and shows what it answers', async () => {
    const { write, user } = setup({
      write: () => Promise.resolve({ modes: { ...MODES, current: 'plan' }, pending: undefined }),
    })
    await user.click(await trigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'Plan' }))
    expect(write).toHaveBeenCalledWith('cli-x', 'plan')
    expect(await screen.findByRole('button', { name: 'CLI 模式，当前 Plan' })).toBeTruthy()
  })

  it('leaves the CLI alone when the mode is already set', async () => {
    const { write, user } = setup()
    await user.click(await trigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'Default' }))
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a refused switch', async () => {
    const { user } = setup({ write: () => Promise.reject(new Error('这个 CLI 没有报告模式 plan。')) })
    await user.click(await trigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'Plan' }))
    expect((await screen.findByRole('alert')).textContent).toContain('这个 CLI 没有报告模式 plan。')
  })

  it('clears the failure once its toast is done', async () => {
    const { user } = setup({ write: () => Promise.reject(new Error('这个 CLI 没有报告模式 plan。')) })
    await user.click(await trigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'Plan' }))
    await user.click(await screen.findByRole('button', { name: 'stub-toast-done' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a pick the CLI has not confirmed yet, with when it applies', async () => {
    setup({ reply: { modes: MODES, pending: 'plan' } })
    const button = await trigger()
    expect(button.getAttribute('aria-label')).toBe('CLI 模式，当前 Plan')
    expect(button.getAttribute('title')).toContain('下一条消息发送时生效')
  })

  // Nothing changes a pick until a message runs, and nothing tells the control when that
  // happened: it asks again for a while, then stops.
  it('asks again while a pick waits for a running session', async () => {
    let answer: ModeReply = { modes: MODES, pending: 'plan' }
    const read = vi.fn<ModeApi['read']>(() => Promise.resolve(answer))
    const api = { read, write: vi.fn<ModeApi['write']>() }
    const view = (started: boolean): ReactElement => (
      <div data-composer-card>
        <ModeMenu provider="cli-x" api={api} locked={false} started={started} />
      </div>
    )
    const { rerender } = render(view(true))
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(
      () => {
        expect(read.mock.calls.length).toBeGreaterThan(1)
      },
      { timeout: MODE_POLL_MS * 4 },
    )
    answer = { modes: { ...MODES, current: 'plan' }, pending: undefined }
    await vi.waitFor(
      () => {
        expect(screen.getByRole('button', { name: /CLI 模式/ }).getAttribute('title')).not.toContain('下一条')
      },
      { timeout: MODE_POLL_MS * 4 },
    )
    const settled = read.mock.calls.length
    await new Promise((resolve) => {
      setTimeout(resolve, MODE_POLL_MS + 300)
    })
    expect(read.mock.calls.length).toBe(settled)
    rerender(view(false))
    expect(screen.getByRole('button', { name: /CLI 模式/ }).getAttribute('title')).not.toContain('下一条')
  })

  it('does not ask again before the session has a CLI to take the pick', async () => {
    const { read } = setup({ reply: { modes: MODES, pending: 'plan' }, started: false })
    await trigger()
    const asked = read.mock.calls.length
    await new Promise((resolve) => {
      setTimeout(resolve, MODE_POLL_MS + 700)
    })
    expect(read.mock.calls.length).toBe(asked)
  })

  // A pick the CLI never takes must not keep the route busy forever. Fake timers walk the
  // whole budget at once: the interval stops itself rather than asking a 41st time.
  it('stops asking once its polling budget runs out', async () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn<ModeApi['read']>(() => Promise.resolve({ modes: MODES, pending: 'plan' }))
      const api = { read, write: vi.fn<ModeApi['write']>() }
      render(
        <div data-composer-card>
          <ModeMenu provider="cli-x" api={api} locked={false} started />
        </div>,
      )
      // Let the first read settle so the pending effect starts its interval.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const initial = read.mock.calls.length
      expect(initial).toBeGreaterThan(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MODE_POLL_MS * (MODE_POLL_TRIES + 2))
      })
      expect(read.mock.calls.length).toBe(initial + MODE_POLL_TRIES)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MODE_POLL_MS * 5)
      })
      expect(read.mock.calls.length).toBe(initial + MODE_POLL_TRIES)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('is closed while the session is gone', async () => {
    const { user } = setup({ locked: true })
    const button = await trigger()
    expect(button).toHaveProperty('disabled', true)
    await user.click(button)
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  })
})
