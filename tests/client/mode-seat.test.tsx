// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The permission seat: on a CLI session it shows the CLI's own modes, and on a session the
 * harness runs it shows nothing, so the harness's access control keeps that seat.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryState } from '../../src/client/choices.ts'
import type { ModeApi, ModeReply } from '../../src/client/mode-api.ts'
import { CliModeSeat } from '../../src/client/mode-seat.tsx'
import type { Store } from '../../src/client/store.ts'

const ANSWER: ModeReply = {
  modes: {
    configId: 'mode',
    current: 'default',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  },
  pending: undefined,
}

const CLI_DIRECTORY: DirectoryState = {
  groups: [{ id: 'cli-fake', name: 'Fake CLI', models: [{ id: 'default', name: 'Fake' }] }],
  current: { provider: 'cli-fake', model: 'default' },
}

const HARNESS_DIRECTORY: DirectoryState = {
  groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }],
  current: { provider: 'deepseek-official', model: 'chat' },
}

const storeOf = (state: DirectoryState): Store<DirectoryState> => ({
  subscribe: () => () => {
    /* the test never changes the directory */
  },
  getSnapshot: () => state,
})

function api(reply: ModeReply = ANSWER): ModeApi {
  return { read: vi.fn(() => Promise.resolve(reply)), write: vi.fn(() => Promise.resolve(reply)) }
}

afterEach(cleanup)

describe('CliModeSeat', () => {
  it('shows the CLI own modes in the permission seat', async () => {
    const modes = api()
    const { container } = render(<CliModeSeat directory={storeOf(CLI_DIRECTORY)} modes={modes} session={undefined} />)
    expect(container.querySelector('.dsh-cli-mode-seat')).not.toBeNull()
    expect((await screen.findByRole('button', { name: /CLI 模式/ })).getAttribute('aria-label')).toBe(
      'CLI 模式，当前 Default',
    )
    expect(modes.read).toHaveBeenCalledWith('cli-fake')
  })

  it('leaves the seat to the harness on a session the harness runs', () => {
    const modes = api()
    const { container } = render(
      <CliModeSeat directory={storeOf(HARNESS_DIRECTORY)} modes={modes} session={undefined} />,
    )
    expect(container.innerHTML).toBe('')
    expect(modes.read).not.toHaveBeenCalled()
  })

  it('still claims the seat for a CLI that reports no modes, so no access control takes it', async () => {
    const modes = api({ modes: undefined, pending: undefined })
    const { container } = render(<CliModeSeat directory={storeOf(CLI_DIRECTORY)} modes={modes} session={undefined} />)
    expect(container.querySelector('.dsh-cli-mode-seat')).not.toBeNull()
    await vi.waitFor(() => {
      expect(modes.read).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /CLI 模式/ })).toBeNull()
  })

  it('shows nothing when the harness offers no mode route', () => {
    const { container } = render(
      <CliModeSeat directory={storeOf(CLI_DIRECTORY)} modes={undefined} session={undefined} />,
    )
    // The seat is claimed, but there is no control to put in it.
    expect(container.querySelector('.dsh-cli-mode-seat')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
