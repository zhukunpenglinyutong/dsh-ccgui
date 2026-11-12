// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * A session the harness runs keeps its own model seat, which also carries settings such as
 * the agent-team toggle, so this control renders nothing there. The reasoning-level menu is
 * still the plugin's on a CLI session and is checked here against a CLI's own catalog.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DirectoryState } from '../../src/client/choices.ts'
import { CliModelMenu } from '../../src/client/model-menu.tsx'
import type { ModelMenuInjected } from '../../src/client/model-menu.tsx'
import { createStore } from '../fixtures/client-store.ts'

const REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}
const CLI = {
  id: 'cli-fake',
  name: 'Fake CLI',
  models: [
    { id: 'flash', name: 'DeepSeek Flash', reasoning: REASONING },
    { id: 'pro', name: 'DeepSeek Pro' },
  ],
}
const DEEPSEEK = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'flash', name: 'DeepSeek Flash', reasoning: REASONING }],
}
const CLAUDE = { id: 'cli-claude', name: 'Claude Code', models: [{ id: 'opus', name: 'Opus' }] }
const ACME = { id: 'acme', name: 'Acme', models: [{ id: 'a1', name: 'Acme One' }] }

type SelectResult = Awaited<ReturnType<ModelMenuInjected['select']>>

function directoryState(fields: Partial<DirectoryState> = {}): DirectoryState {
  return { groups: [CLI, CLAUDE, ACME], current: { provider: 'cli-fake', model: 'flash' }, ...fields }
}

function setup(state = directoryState(), result: () => Promise<SelectResult> = () => Promise.resolve({})) {
  const directory = createStore(state)
  const select = vi.fn<ModelMenuInjected['select']>(result)
  render(
    <div data-composer-card>
      <CliModelMenu available directory={directory} load={vi.fn()} select={select} session={undefined} />,
    </div>,
  )
  return { directory, select, user: userEvent.setup() }
}

/** Render a directory the harness itself runs, where the native seat must stay untouched. */
function renderHarness(state: DirectoryState) {
  return render(
    <div data-composer-card>
      <CliModelMenu available directory={createStore(state)} load={vi.fn()} select={vi.fn()} session={undefined} />
    </div>,
  )
}

const trigger = () => screen.getByRole('button', { name: /^(选择模型|请选择模型|正在加载模型)/ })
const effortButton = () => screen.queryByRole('button', { name: /^推理等级/ })
const rowNames = () => screen.queryAllByRole('menuitemradio').map((row) => row.getAttribute('title') ?? row.textContent)

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('model control on a harness provider', () => {
  it('renders nothing so the harness keeps its own seat and its team toggle', () => {
    const { container } = renderHarness({
      groups: [DEEPSEEK, CLAUDE, ACME],
      current: { provider: 'deepseek-official', model: 'flash' },
    })
    expect(container.querySelector('.dsh-cli-model')).toBeNull()
    expect(screen.queryByRole('button', { name: /^推理等级/ })).toBeNull()
  })

  it('renders nothing while the session has no selection yet', () => {
    const { container } = renderHarness({ groups: [DEEPSEEK], current: null, status: 'loading' })
    expect(container.querySelector('.dsh-cli-model')).toBeNull()
  })

  it('still offers a CLI menu before that CLI has reported its models', () => {
    setup(directoryState({ groups: [CLAUDE], current: { provider: 'cli-fake', model: 'gone' } }))
    expect(trigger().textContent).toContain('请选择模型')
  })

  it('lists only the CLI models on a CLI session', async () => {
    const { user } = setup()
    await user.click(trigger())
    expect(rowNames()).toEqual(['DeepSeek Flash', 'DeepSeek Pro'])
  })
})

describe('reasoning level', () => {
  it('shows the level beside the model and changes it', async () => {
    const { user, select } = setup()
    expect(effortButton()?.textContent).toContain('High')
    await user.click(effortButton() ?? document.body)
    expect(rowNames()).toEqual(['Low', 'High'])
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    expect(select).toHaveBeenCalledWith({ provider: 'cli-fake', model: 'flash', reasoningEffort: 'low' })
  })

  it('leaves the session alone when the current level is chosen', async () => {
    const { user, select } = setup()
    await user.click(effortButton() ?? document.body)
    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))
    expect(select).not.toHaveBeenCalled()
    expect(rowNames()).toEqual([])
  })

  it('selects the provider default without naming a level', async () => {
    const reasoning = { efforts: REASONING.efforts }
    const groups = [{ ...CLI, models: [{ id: 'flash', name: 'DeepSeek Flash', reasoning }] }]
    const current = { provider: 'cli-fake', model: 'flash', reasoningEffort: 'low' }
    const { user, select } = setup(directoryState({ groups, current }))
    await user.click(effortButton() ?? document.body)
    await user.click(screen.getByRole('menuitemradio', { name: 'Default' }))
    expect(select).toHaveBeenCalledWith({ provider: 'cli-fake', model: 'flash' })
  })

  it('still offers the levels when the session holds one the model no longer lists', () => {
    setup(directoryState({ current: { provider: 'cli-fake', model: 'flash', reasoningEffort: 'max' } }))
    expect(effortButton()?.textContent).toContain('推理等级')
  })

  it('closes its menu on request', async () => {
    const { user } = setup()
    await user.click(effortButton() ?? document.body)
    await user.click(screen.getByRole('button', { name: 'stub-close' }))
    expect(rowNames()).toEqual([])
  })

  it('reports a failed change in a toast', async () => {
    const { user } = setup(directoryState(), () => Promise.resolve({ error: { message: 'busy' } }))
    await user.click(effortButton() ?? document.body)
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    expect((await screen.findByRole('alert')).textContent).toContain('切换推理等级失败：busy')
  })

  it('reports a rejected change in a toast', async () => {
    const { user } = setup(directoryState(), () => Promise.reject(new Error('gone')))
    await user.click(effortButton() ?? document.body)
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))
    expect((await screen.findByRole('alert')).textContent).toContain('切换推理等级失败：Error: gone')
  })

  it('is absent for a model without levels, and while a selection settles it is disabled', () => {
    setup(directoryState({ current: { provider: 'cli-fake', model: 'pro' } }))
    expect(effortButton()).toBeNull()
    cleanup()
    setup(directoryState({ pending: { provider: 'cli-fake', model: 'pro' } }))
    expect(effortButton()?.hasAttribute('disabled')).toBe(true)
  })
})
