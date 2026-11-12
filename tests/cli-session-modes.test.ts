import { describe, expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { CliModeList, CliModelList } from '../src/model-options.ts'
import { collect, finishOf, setupWith, textOf, user } from './fixtures/cli-session-helpers.ts'

const modelOption: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'small',
  options: [
    { value: 'small', name: 'Small' },
    { value: 'fast', name: 'Fast' },
  ],
}

const modeOption: SessionConfigOption = {
  id: 'permission_mode',
  name: 'Permission mode',
  category: 'mode',
  type: 'select',
  currentValue: 'acceptEdits',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'acceptEdits', name: 'Accept edits' },
    { value: 'plan', name: 'Plan' },
  ],
}

const end = () => 'end_turn' as const

// A CLI's modes are its own vocabulary. The session only reports them verbatim; it
// never turns them into a harness preset or decides what they mean.
describe('CliSession native modes', () => {
  it('reports the modes exactly as the CLI stated them', async () => {
    const onModes = vi.fn((_modes: CliModeList) => {})
    const { fake, session } = setupWith({ onModes }, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(onModes).toHaveBeenCalledWith({
      configId: 'permission_mode',
      current: 'acceptEdits',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'acceptEdits', name: 'Accept edits' },
        { value: 'plan', name: 'Plan' },
      ],
    })
  })

  it('says nothing when the CLI reports no modes', async () => {
    const onModes = vi.fn((_modes: CliModeList) => {})
    const { fake, session } = setupWith({ onModes }, end)
    fake.configOptions = [modelOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(onModes).not.toHaveBeenCalled()
  })

  it('keeps a mode id that happens to equal a model id', async () => {
    const onModes = vi.fn((_modes: CliModeList) => {})
    const { fake, session } = setupWith({ onModes }, end)
    fake.configOptions = [
      modelOption,
      { ...modeOption, options: [{ value: 'small', name: 'Small mode' }], currentValue: 'small' },
    ]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(onModes).toHaveBeenCalledWith(expect.objectContaining({ configId: 'permission_mode', current: 'small' }))
  })

  it('exposes on the session the modes the CLI last reported', async () => {
    const { fake, session } = setupWith({}, end)
    expect(session.modes).toBeUndefined()
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(session.modes).toEqual({
      configId: 'permission_mode',
      current: 'acceptEdits',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'acceptEdits', name: 'Accept edits' },
        { value: 'plan', name: 'Plan' },
      ],
    })
  })
})

// Switching goes out as the id the CLI gave, and the answer decides what the control shows.
describe('CliSession switching mode', () => {
  it('sends the picked id and reports the CLI answer', async () => {
    const onModes = vi.fn((_modes: CliModeList) => {})
    const { fake, session } = setupWith({ onModes }, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigResult = [{ ...modeOption, currentValue: 'plan' }]
    await expect(session.switchMode('plan')).resolves.toMatchObject({ current: 'plan' })
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'permission_mode', value: 'plan' }])
    expect(session.modes).toMatchObject({ current: 'plan' })
  })

  // The catalog speaks for sessions that have no CLI yet, and a new process starts in the
  // CLI's own default. A switch in one session must not make another look switched.
  it('tells the catalog the mode a new session starts in, not a later switch', async () => {
    const onModes = vi.fn((_modes: CliModeList) => {})
    const { fake, session } = setupWith({ onModes }, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigResult = [{ ...modeOption, currentValue: 'plan' }]
    await session.switchMode('plan')
    expect(onModes).toHaveBeenCalledTimes(1)
    expect(onModes).toHaveBeenLastCalledWith(expect.objectContaining({ current: 'acceptEdits' }))
  })

  it('leaves the CLI alone when it is already on that mode', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    await session.switchMode('acceptEdits')
    expect(fake.setConfigCalls).toEqual([])
  })

  it('keeps a pick made before the CLI started until its first step', async () => {
    const known: CliModelList = {
      configId: 'model',
      current: 'small',
      options: [
        { value: 'small', name: 'Small' },
        { value: 'fast', name: 'Fast' },
      ],
      modes: {
        configId: 'permission_mode',
        current: 'acceptEdits',
        options: [
          { value: 'acceptEdits', name: 'Accept edits' },
          { value: 'plan', name: 'Plan' },
        ],
      },
    }
    const { fake, session } = setupWith({ knownModels: () => known }, end)
    fake.configOptions = [modelOption, { ...modeOption, options: [...(known.modes?.options ?? [])] }]
    fake.setConfigResult = [{ ...modeOption, currentValue: 'plan' }]
    await expect(session.switchMode('plan')).resolves.toMatchObject({ current: 'acceptEdits' })
    expect(fake.setConfigCalls).toEqual([])
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(fake.setConfigCalls).toEqual([{ sessionId: 'acp-1', configId: 'permission_mode', value: 'plan' }])
    expect(session.pendingMode).toBeUndefined()
  })

  it('refuses a mode the CLI never offered', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    await expect(session.switchMode('yolo')).rejects.toMatchObject({ code: 'CLI_MODE_FAILED' })
    expect(fake.setConfigCalls).toEqual([])
  })

  it('refuses before any list is known', async () => {
    const { session } = setupWith({}, end)
    await expect(session.switchMode('plan')).rejects.toMatchObject({ code: 'CLI_MODE_FAILED' })
  })

  it('reports a CLI that keeps its old mode', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigResult = [modeOption]
    await expect(session.switchMode('plan')).rejects.toMatchObject({ code: 'CLI_MODE_FAILED' })
  })

  it('reports a transport failure with the CLI name', async () => {
    const { fake, session } = setupWith({}, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigError = new Error('broken pipe')
    await expect(session.switchMode('plan')).rejects.toThrow(/OpenCode 无法切换到模式 plan：broken pipe/)
  })
})

// A pick the CLI will not take must not hold the conversation hostage: the message still
// goes out, in the mode the CLI is actually in, and the user is told why.
describe('CliSession refused mode', () => {
  const known: CliModelList = {
    configId: 'model',
    current: 'small',
    options: [{ value: 'small', name: 'Small' }],
    modes: {
      configId: 'permission_mode',
      current: 'acceptEdits',
      options: [
        { value: 'acceptEdits', name: 'Accept edits' },
        { value: 'plan', name: 'Plan' },
      ],
    },
  }

  it('sends the first message anyway when the CLI refuses the mode picked before it started', async () => {
    const onModeRefused = vi.fn((_mode: string) => {})
    const { fake, session } = setupWith({ knownModels: () => known, initialMode: 'plan', onModeRefused }, end)
    fake.configOptions = [modelOption, modeOption]
    fake.setConfigError = new Error('plan is not allowed here')
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(textOf(chunks)).toContain('无法切换到模式 plan')
    expect(textOf(chunks)).toContain('plan is not allowed here')
    expect(finishOf(chunks)?.reason.kind).toBe('stop')
    expect(fake.prompts).toHaveLength(1)
    expect(session.pendingMode).toBeUndefined()
    expect(onModeRefused).toHaveBeenCalledWith('plan')
  })

  it('does not try a refused mode again with the next message', async () => {
    const { fake, session } = setupWith({ knownModels: () => known, initialMode: 'plan' }, end, end)
    fake.configOptions = [modelOption, modeOption]
    fake.setConfigError = new Error('no')
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    await collect(session.stream({ messages: [user('1', 'hi'), user('2', 'again')] }))
    expect(fake.setConfigCalls).toHaveLength(1)
  })

  it('drops a pick the started CLI does not offer, without sending it', async () => {
    const onModeRefused = vi.fn((_mode: string) => {})
    const { fake, session } = setupWith({ knownModels: () => known, initialMode: 'yolo', onModeRefused }, end)
    fake.configOptions = [modelOption, modeOption]
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(fake.setConfigCalls).toEqual([])
    expect(textOf(chunks)).toContain('无法切换到模式 yolo')
    expect(onModeRefused).toHaveBeenCalledWith('yolo')
    expect(session.pendingMode).toBeUndefined()
  })

  // The notice is the plugin's own words, so a refusal in the same turn must still be
  // explained by the CLI, here through the reason it attached to its answer.
  it('does not give its own notice as the reason the CLI refused', async () => {
    const quota = '{"message":"Quota exceeded: 429","data":{"details":"免费额度已用完，请明天再试"}}'
    const { fake, session } = setupWith({ knownModels: () => known, initialMode: 'plan' }, () => ({
      stopReason: 'refusal' as const,
      meta: { 'codebuddy.ai/errorMessage': quota },
    }))
    fake.configOptions = [modelOption, modeOption]
    fake.setConfigError = new Error('plan is not allowed here')
    const finish = finishOf(await collect(session.stream({ messages: [user('1', 'hi')] })))
    expect(finish?.reason).toMatchObject({ kind: 'error', failure: { code: 'CLI_REFUSAL' } })
    const message = finish?.reason.kind === 'error' ? finish.reason.failure.message : ''
    expect(message).toContain('免费额度已用完')
    expect(message).not.toContain('无法切换到模式')
  })

  it('forgets a live switch the CLI refused, so the next message does not retry it', async () => {
    const { fake, session } = setupWith({}, end, end)
    fake.configOptions = [modelOption, modeOption]
    await collect(session.stream({ messages: [user('1', 'hi')] }))
    fake.setConfigResult = [modeOption]
    await expect(session.switchMode('plan')).rejects.toMatchObject({ code: 'CLI_MODE_FAILED' })
    expect(session.pendingMode).toBeUndefined()
    await collect(session.stream({ messages: [user('1', 'hi'), user('2', 'again')] }))
    expect(fake.setConfigCalls).toHaveLength(1)
  })
})
