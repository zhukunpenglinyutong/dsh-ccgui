import { describe, expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { ModeState } from '../../src/session/mode-state.ts'
import type { ModelTarget } from '../../src/session/model-state.ts'
import type { CliModeList } from '../../src/model-options.ts'
import { FakeTransport } from '../fixtures/fake-transport.ts'

const MODES: CliModeList = {
  configId: 'permission_mode',
  current: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'plan', name: 'Plan' },
  ],
}

const reported = (current: string, options = MODES.options): SessionConfigOption[] => [
  {
    id: 'permission_mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: current,
    options: [...options],
  },
]

function target(fake: FakeTransport): ModelTarget {
  return { transport: fake, acpSessionId: 'acp-1', label: 'OpenCode' }
}

describe('ModeState.settle', () => {
  it('has nothing to do without a pick', async () => {
    const fake = new FakeTransport()
    const state = new ModeState(() => MODES, vi.fn())
    await expect(state.settle(target(fake), undefined)).resolves.toBeUndefined()
    expect(fake.setConfigCalls).toEqual([])
  })

  // Nothing was refused when the step itself was cancelled, so the pick waits for the next one.
  it('keeps the pick and passes the cancellation on when the wait is aborted', async () => {
    const fake = new FakeTransport()
    const state = new ModeState(() => MODES, vi.fn(), 'plan')
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(state.settle(target(fake), controller.signal)).rejects.toThrow('stopped')
    expect(state.pending).toBe('plan')
  })

  it("names the mode the message runs in by the CLI's own name", async () => {
    const fake = new FakeTransport()
    fake.setConfigError = new Error('no')
    const state = new ModeState(() => MODES, vi.fn(), 'plan')
    const refusal = await state.settle(target(fake), undefined)
    expect(refusal?.mode).toBe('plan')
    expect(refusal?.notice).toContain('「Default」')
  })

  it('falls back to the id when the CLI reports a current mode it does not list', async () => {
    const fake = new FakeTransport()
    fake.setConfigError = new Error('no')
    const state = new ModeState(() => MODES, vi.fn(), 'plan')
    state.observe(reported('hidden'))
    const refusal = await state.settle(target(fake), undefined)
    expect(refusal?.notice).toContain('「hidden」')
  })
})
