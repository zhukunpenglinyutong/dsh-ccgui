import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import CliBridge from '../src/index.ts'
import type { CliAgentConfig, Config } from '../src/index.ts'
import { CLI_TOOL_NAME, DEFAULT_MODEL_ID } from '../src/constants.ts'
import { collect, textOf, toolCallOf, user } from './fixtures/cli-session-helpers.ts'
import {
  BASE,
  BROKEN,
  FAKE,
  FAKE_AGENT,
  SILENT,
  WAIT,
  addAgent,
  emitSessionEvent,
  fake,
  harness,
  load,
  onlyAdapter,
  onlyTool,
  openTurn,
  request,
  sid,
  start,
  stopStarted,
  warnings,
} from './fixtures/plugin-harness.ts'

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

/** Validate a raw config the way cordis does before constructing the plugin. */
function validate(input: unknown): { value?: unknown; issues?: readonly unknown[] } {
  const result = CliBridge.Config['~standard'].validate(input)
  if (result instanceof Promise) throw new Error('the schema must validate synchronously')
  return result
}

describe('CliBridge.Config', () => {
  it('fills every default for an empty config', () => {
    expect(validate({})).toEqual({
      value: {
        agents: [],
        disposeGraceMs: 3_000,
        disposeEofGraceMs: 6_000,
        cancelGraceMs: 10_000,
        startTimeoutMs: 120_000,
        reviewProvider: '',
        reviewModel: '',
      },
    })
  })

  it('accepts the shipped patch shape and defaults args and env', () => {
    const { value, issues } = validate({
      agents: [
        { id: 'claude', name: 'Claude Code', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
        { id: 'omp', name: 'OMP CLI', command: 'omp' },
      ],
    })
    expect(issues).toBeUndefined()
    expect(value).toMatchObject({
      agents: [
        {
          id: 'claude',
          name: 'Claude Code',
          command: 'npx',
          args: ['-y', '@agentclientprotocol/claude-agent-acp'],
          env: {},
        },
        { id: 'omp', name: 'OMP CLI', command: 'omp', args: [], env: {} },
      ],
    })
  })

  it.each([
    ['an agent without id', { agents: [{ name: 'X', command: 'x' }] }],
    ['an agent without name', { agents: [{ id: 'x', command: 'x' }] }],
    ['an agent without command', { agents: [{ id: 'x', name: 'X' }] }],
    ['non-string args', { agents: [{ id: 'x', name: 'X', command: 'x', args: [1] }] }],
    ['non-string env values', { agents: [{ id: 'x', name: 'X', command: 'x', env: { A: 1 } }] }],
    ['a zero grace', { disposeGraceMs: 0 }],
    ['a zero EOF grace', { disposeEofGraceMs: 0 }],
    ['a zero cancel grace', { cancelGraceMs: 0 }],
    ['a zero start timeout', { startTimeoutMs: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(validate(input).issues?.length).toBeGreaterThan(0)
  })

  it('does not start the plugin with an invalid config', async () => {
    const h = harness()
    const fiber = h.root.plugin(
      CliBridge,
      // Deliberately incomplete: the agent has no command.
      fake<Config>({ agents: [fake<CliAgentConfig>({ id: 'x', name: 'X' })] }),
    )
    await fiber.then(
      () => undefined,
      () => undefined,
    )
    expect(h.root.get('cliBridge')).toBeUndefined()
    expect(h.adapters).toEqual([])
    expect(h.tools).toEqual([])
    await fiber.dispose()
  })
})

describe('CliBridge wiring', () => {
  it('waits for every injected service before starting', async () => {
    const root = new Context()
    root.provide('llm', {
      registerAdapter: vi.fn(),
      listProviders: () => [],
      listModels: () => Promise.resolve([]),
      stream: vi.fn(),
    })
    root.provide('agents', { get: () => undefined })
    root.provide('subprocess', { spawn: vi.fn() })
    const fiber = root.plugin(CliBridge, BASE)
    expect(root.get('cliBridge')).toBeUndefined()
    const register = vi.fn(() => () => undefined)
    root.provide('tools', { register })
    await fiber
    expect(root.get('cliBridge')).toBeInstanceOf(CliBridge)
    expect(register).toHaveBeenCalledTimes(1)
    await fiber.dispose()
  })

  it('registers one adapter for every configured CLI route', async () => {
    const h = harness()
    await start(h, { agents: [FAKE, SILENT] })
    expect(h.root.get('cliBridge')).toBeInstanceOf(CliBridge)
    expect(h.adapters.map(({ providers }) => providers)).toEqual([['cli-fake', 'cli-silent']])
    const adapter = onlyAdapter(h)
    expect(adapter.providerInfo('cli-silent')).toEqual({ id: 'cli-silent', name: 'Silent CLI' })
    await expect(adapter.listModels('cli-fake')).resolves.toEqual([
      { provider: 'cli-fake', id: DEFAULT_MODEL_ID, name: 'Fake CLI' },
    ])
    await expect(adapter.resolveModel('cli-fake', 'x')).resolves.toMatchObject({ id: 'x', name: 'x' })
  })

  it('registers no adapter without CLIs, but still the mirror tool', async () => {
    const h = harness()
    await start(h, { agents: [] })
    expect(h.adapters).toEqual([])
    expect(onlyTool(h).definition.name).toBe(CLI_TOOL_NAME)
  })

  it('admits the mirror tool only for steps on a CLI route', async () => {
    const h = harness()
    await start(h)
    const { definition, options } = onlyTool(h)
    expect(definition.name).toBe(CLI_TOOL_NAME)
    const when = options?.when
    if (when === undefined) throw new Error('the tool must be conditional')
    const { agent } = addAgent(h)
    const step = (provider: string) =>
      when({ agent, modelSelection: { provider, model: DEFAULT_MODEL_ID }, signal: new AbortController().signal })
    expect(step('cli-fake')).toBe(true)
    expect(step('cli-other')).toBe(false)
    expect(step('deepseek')).toBe(false)
  })

  it('refuses the mirror tool for a session without a CLI', async () => {
    const h = harness()
    await start(h)
    const { agent } = addAgent(h)
    const exec = fake<ToolRunContext>({
      agent,
      callId: fake<ToolRunContext['callId']>('cli-1'),
      signal: AbortSignal.timeout(5_000),
    })
    await expect(onlyTool(h).definition.execute({ title: 't', kind: 'edit' }, exec)).rejects.toThrow(CLI_TOOL_NAME)
  })
})

describe('CliBridge routing and model listing', () => {
  it('selects the CLI a new agent preset stands for and lists its models', async () => {
    const h = harness()
    await start(h)
    const { agent, select } = addAgent(h, { preset: 'cli-fake' })
    await h.root.serial('agent/created', { agent, source: 'startup' })
    expect(select).toHaveBeenCalledWith({ provider: 'cli-fake', model: DEFAULT_MODEL_ID })
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake']), WAIT)
    await expect(onlyAdapter(h).listModels('cli-fake')).resolves.toEqual([
      { provider: 'cli-fake', id: DEFAULT_MODEL_ID, name: 'Fake Small（默认）' },
      { provider: 'cli-fake', id: 'fake-large', name: 'Fake Large' },
    ])
    // The probe runs in a fixed directory under the harness home, started through ctx.subprocess.
    const probeDir = join(h.dshHome, 'ccgui', 'model-probe')
    expect(existsSync(probeDir)).toBe(true)
    expect(h.subprocess.spawned.map(({ spec }) => [spec.argv, spec.cwd])).toEqual([
      [[process.execPath, FAKE_AGENT], probeDir],
    ])
    expect(h.subprocess.spawned[0]?.spec).toMatchObject({ graceMs: 200 })
  })

  it('leaves an agent on a non-CLI preset alone and starts nothing', async () => {
    const h = harness()
    await start(h)
    const { agent, select } = addAgent(h, { preset: 'default' })
    await h.root.serial('agent/created', { agent, source: 'startup' })
    expect(select).not.toHaveBeenCalled()
    expect(h.subprocess.spawned).toEqual([])
  })

  it('probes under ~/.dsh when the harness provides no home path', async () => {
    const h = harness({ homePath: false })
    await start(h)
    const { agent } = addAgent(h, { preset: 'cli-fake' })
    await h.root.serial('agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake']), WAIT)
    const probeDir = join(home.dir, '.dsh', 'ccgui', 'model-probe')
    expect(existsSync(probeDir)).toBe(true)
    expect(h.subprocess.spawned[0]?.spec.cwd).toBe(probeDir)
  })

  it('routes again once a preset switch has been published', async () => {
    const h = harness()
    await start(h)
    const { agent, select } = addAgent(h, { preset: 'cli-fake' })
    h.root.emit('agent-preset/selected', agent.id, 'cli-fake')
    // Deferred to a microtask, because the switch is still being published.
    expect(select).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(select).toHaveBeenCalledWith({ provider: 'cli-fake', model: DEFAULT_MODEL_ID })
  })

  it('ignores a preset switch for a session that is already gone', async () => {
    const h = harness()
    await start(h)
    h.root.emit('agent-preset/selected', sid('missing'), 'cli-fake')
    await Promise.resolve()
    expect(warnings(h)).toEqual([])
    expect(h.subprocess.spawned).toEqual([])
  })

  it('logs instead of throwing when a preset switch cannot select the CLI', async () => {
    const h = harness()
    await start(h)
    const { agent, select } = addAgent(h, { preset: 'cli-fake' })
    select.mockImplementation(() => {
      throw new Error('busy')
    })
    h.root.emit('agent-preset/selected', agent.id, 'cli-fake')
    await Promise.resolve()
    expect(warnings(h)).toEqual(['ccgui: could not select the CLI for dsh-1: Error: busy'])
  })

  it('probes when the session log records a CLI model selection', async () => {
    const h = harness()
    await start(h)
    emitSessionEvent(h, 'dsh-1', { type: 'model/selection', data: { provider: 'cli-fake' } })
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake']), WAIT)
  })

  it('warns when a CLI cannot be started to list its models', async () => {
    const h = harness()
    await start(h, { agents: [BROKEN] })
    emitSessionEvent(h, 'dsh-1', { type: 'model/selection', data: { provider: 'cli-broken' } })
    await vi.waitFor(() => expect(warnings(h)).toHaveLength(1), WAIT)
    expect(warnings(h)[0]).toMatch(/^ccgui: could not list models for cli-broken: /)
    expect(h.modelUpdates).toEqual([])
  })

  it('shows the models a previous run found before probing again', async () => {
    const h = harness()
    const first = await load(h)
    emitSessionEvent(h, 'dsh-1', { type: 'model/selection', data: { provider: 'cli-fake' } })
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake']), WAIT)
    await vi.waitFor(() => expect(existsSync(join(h.dshHome, 'ccgui', 'models.json'))).toBe(true), WAIT)
    await first.dispose()
    await h.subprocess.allExited()
    h.adapters.length = 0
    await start(h)
    await vi.waitFor(() => expect(h.modelUpdates).toEqual(['cli-fake', 'cli-fake']), WAIT)
    await expect(onlyAdapter(h).listModels('cli-fake')).resolves.toHaveLength(2)
    expect(h.subprocess.spawned).toHaveLength(1)
  })

  it('warns and starts empty when the saved models cannot be read', async () => {
    const h = harness()
    mkdirSync(join(h.dshHome, 'ccgui', 'models.json'), { recursive: true })
    await start(h)
    await vi.waitFor(() => expect(warnings(h)).toHaveLength(1), WAIT)
    expect(warnings(h)[0]).toMatch(/^ccgui: could not read saved model lists: /)
    await expect(onlyAdapter(h).listModels('cli-fake')).resolves.toHaveLength(1)
  })

  it('drops an unfinished probe silently when the plugin is disposed', async () => {
    const h = harness()
    const fiber = await load(h, { agents: [SILENT] })
    emitSessionEvent(h, 'dsh-1', { type: 'model/selection', data: { provider: 'cli-silent' } })
    await vi.waitFor(() => expect(h.subprocess.spawned).toHaveLength(1), WAIT)
    await fiber.dispose()
    await h.subprocess.allExited()
    // Let the aborted probe settle before checking that it reported nothing.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(warnings(h)).toEqual([])
    expect(h.modelUpdates).toEqual([])
    expect(h.root.get('cliBridge')).toBeUndefined()
  })
})

describe('CliBridge sessions', () => {
  it('runs a turn on the CLI in the session directory, with the turn read from the log', async () => {
    const h = harness()
    await start(h)
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-cwd-'))
    addAgent(h, { cwd })
    openTurn(h, 'dsh-1', ['m1'])
    const chunks = await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))
    expect(textOf(chunks)).toBe('echo: hello')
    expect(h.subprocess.spawned.map(({ spec }) => [spec.argv, spec.cwd])).toEqual([
      [[process.execPath, FAKE_AGENT], cwd],
    ])
    expect(h.subprocess.spawned[0]?.spec).toMatchObject({ graceMs: 200 })
  })

  it('passes the configured environment to the CLI', async () => {
    const h = harness()
    await start(h, { agents: [{ ...FAKE, env: { CLI_TOKEN: 'secret' } }] })
    addAgent(h)
    openTurn(h, 'dsh-1', ['m1'])
    await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))
    expect(h.subprocess.spawned[0]?.spec.env).toMatchObject({ CLI_TOKEN: 'secret' })
  })

  it.runIf(process.platform !== 'win32')(
    'gives the CLI a PATH that keeps what the harness has, for a node found only by the shell',
    async () => {
      const h = harness()
      await start(h, { agents: [FAKE] })
      addAgent(h)
      openTurn(h, 'dsh-1', ['m1'])
      await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))
      const path = h.subprocess.spawned[0]?.spec.env?.PATH?.split(delimiter) ?? []
      expect(path).toEqual(expect.arrayContaining((process.env.PATH ?? '').split(delimiter).filter(Boolean)))
    },
  )

  it('keeps a PATH the CLI is configured with', async () => {
    const h = harness()
    await start(h, { agents: [{ ...FAKE, env: { PATH: '/configured' } }] })
    addAgent(h)
    openTurn(h, 'dsh-1', ['m1'])
    await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))
    expect(h.subprocess.spawned[0]?.spec.env?.PATH).toBe('/configured')
  })

  it('asks the approval service before the CLI may write, and mirrors the result', async () => {
    const h = harness()
    const approval = {
      request: vi.fn((_request: ApprovalRequest) => Promise.resolve('allowed-once' as const)),
    }
    h.root.provide('approval', approval)
    await start(h)
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-cwd-'))
    const { agent } = addAgent(h, { cwd })
    openTurn(h, 'dsh-1', ['m1'])
    const chunks = await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'WRITE out.txt')] })))
    const call = toolCallOf(chunks)
    expect(call.name).toBe(CLI_TOOL_NAME)
    const signal = AbortSignal.timeout(10_000)
    const exec = fake<ToolRunContext>({ agent, callId: fake<ToolRunContext['callId']>(call.id), signal })
    const result = await onlyTool(h).definition.execute(call.args, exec)
    expect(result).toEqual({
      text: 'Created out.txt',
      diffs: [{ path: join(cwd, 'out.txt'), oldText: null, newText: 'hi\n' }],
    })
    expect(approval.request).toHaveBeenCalledTimes(1)
    const [asked] = approval.request.mock.calls[0] ?? []
    expect(asked).toMatchObject({ agent, toolName: CLI_TOOL_NAME, callId: call.id })
    expect(asked?.reason).toContain(join(cwd, 'out.txt'))
    expect(asked?.signal).toBeInstanceOf(AbortSignal)
    expect(readFileSync(join(cwd, 'out.txt'), 'utf8')).toBe('hi\n')
  })

  // The access mode is DSH's stance for sessions it runs. A CLI decides for itself whether
  // to ask, so its question must not be answered by that stance without asking anyone.
  it('lifts a never-ask stance while the CLI asks, then restores it', async () => {
    const h = harness()
    const order: string[] = []
    let stance: 'ask' | 'never' = 'never'
    const approval = {
      overrideOf: vi.fn(() => {
        order.push(`overrideOf:${stance}`)
        return stance
      }),
      request: vi.fn((_request: ApprovalRequest) => {
        order.push(`request:${stance}`)
        return Promise.resolve('allowed-once' as const)
      }),
    }
    h.root.provide('approval', approval)
    await start(h)
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-cwd-'))
    const { agent } = addAgent(h, { cwd })
    const session = agent.session as unknown as { append: (type: string, data: unknown) => void }
    session.append = vi.fn((_type: string, data: unknown) => {
      stance = (data as { policy: 'ask' | 'never' }).policy
    })
    openTurn(h, 'dsh-1', ['m1'])
    const chunks = await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'WRITE out.txt')] })))
    const call = toolCallOf(chunks)
    const exec = fake<ToolRunContext>({
      agent,
      callId: fake<ToolRunContext['callId']>(call.id),
      signal: AbortSignal.timeout(10_000),
    })
    const result = (await onlyTool(h).definition.execute(call.args, exec)) as { text: string }
    expect(result.text).toContain('Created')
    expect(order).toEqual(['overrideOf:never', 'request:ask', 'overrideOf:ask'])
    expect(vi.mocked(session.append).mock.calls).toEqual([
      ['approval/policy', { policy: 'ask' }],
      ['approval/policy', { policy: 'never' }],
    ])
  })

  it('treats a missing approval service as unavailable and does not write', async () => {
    const h = harness()
    await start(h)
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-cwd-'))
    const { agent } = addAgent(h, { cwd })
    openTurn(h, 'dsh-1', ['m1'])
    const chunks = await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'WRITE out.txt')] })))
    const call = toolCallOf(chunks)
    const exec = fake<ToolRunContext>({
      agent,
      callId: fake<ToolRunContext['callId']>(call.id),
      signal: AbortSignal.timeout(10_000),
    })
    // Nobody could answer, so the CLI is told no and reports the call as failed.
    await expect(onlyTool(h).definition.execute(call.args, exec)).rejects.toThrow('rejected by user')
    expect(existsSync(join(cwd, 'out.txt'))).toBe(false)
  })

  it('stops the CLI when its agent is disposed', async () => {
    const h = harness()
    await start(h)
    const { agent } = addAgent(h)
    openTurn(h, 'dsh-1', ['m1'])
    await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))
    const [spawned] = h.subprocess.spawned
    if (spawned === undefined) throw new Error('no CLI started')
    h.root.emit('agent/disposed', { agent })
    await expect(spawned.done).resolves.toBeDefined()
    // A later step starts a fresh process rather than reusing the stopped one.
    openTurn(h, 'dsh-1', ['m2'])
    await collect(onlyAdapter(h).stream(request({ messages: [user('m2', 'again')] })))
    expect(h.subprocess.spawned).toHaveLength(2)
  })

  it('stops every CLI and withdraws the service when the plugin is disposed', async () => {
    const h = harness()
    const fiber = await load(h)
    addAgent(h, { id: 'dsh-1' })
    addAgent(h, { id: 'dsh-2' })
    for (const sessionId of ['dsh-1', 'dsh-2']) {
      openTurn(h, sessionId, [`${sessionId}-m`])
      await collect(
        onlyAdapter(h).stream(request({ sessionId: sid(sessionId), messages: [user(`${sessionId}-m`, 'hi')] })),
      )
    }
    expect(h.subprocess.spawned).toHaveLength(2)
    await fiber.dispose()
    const outcomes = await Promise.all(h.subprocess.spawned.map(({ done }) => done))
    expect(outcomes).toHaveLength(2)
    expect(h.root.get('cliBridge')).toBeUndefined()
    // Listeners went with the plugin: a later event starts nothing.
    const { agent } = addAgent(h, { id: 'dsh-3', preset: 'cli-fake' })
    await h.root.serial('agent/created', { agent, source: 'startup' })
    expect(h.subprocess.spawned).toHaveLength(2)
  })

  // The harness hot-reloads a plugin whose files changed; the running turns must say why they ended.
  it('tells a running turn that the plugin stopped', async () => {
    const h = harness()
    const fiber = await load(h)
    addAgent(h)
    openTurn(h, 'dsh-1', ['m1'])
    const turn = collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'HANG')] })))
    await vi.waitFor(() => expect(h.subprocess.spawned).toHaveLength(1), WAIT)
    await fiber.dispose()
    await expect(turn).rejects.toThrow('Fake CLI 已停止：dsh-ccgui 插件已停止或重新加载')
    await h.subprocess.allExited()
  })

  it('reports a CLI that fails to start as a start failure', async () => {
    const h = harness()
    await start(h, { agents: [BROKEN] })
    addAgent(h)
    openTurn(h, 'dsh-1', ['m1'])
    await expect(
      collect(onlyAdapter(h).stream(request({ provider: 'cli-broken', messages: [user('m1', 'hello')] }))),
    ).rejects.toMatchObject({ code: 'CLI_START_FAILED', message: /Broken CLI/ })
  })
})

const PTC_RUNTIME = { language: 'typescript', programFormat: 'function-body', timeout: { defaultMs: 1, maxMs: 9_000 } }

describe('CliBridge in PTC mode', () => {
  it('sends a CLI call as run_code and runs its mirror under the nested id', async () => {
    const h = harness()
    h.root.provide('approval', { request: () => Promise.resolve('allowed-once' as const) })
    h.root.provide('ptcRuntime', PTC_RUNTIME)
    await start(h)
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-cwd-'))
    const { agent } = addAgent(h, { cwd, preset: 'ptc' })
    openTurn(h, 'dsh-1', ['m1'])
    const chunks = await collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'WRITE out.txt')] })))
    const call = toolCallOf(chunks)
    expect(call).toMatchObject({ name: 'run_code', args: { timeoutMs: 9_000 } })
    const exec = fake<ToolRunContext>({
      agent,
      callId: fake<ToolRunContext['callId']>(`${call.id}:ptc:1`),
      signal: AbortSignal.timeout(10_000),
    })
    // The arguments the program hands the mirror tool binding.
    const forwarded = /tools\.cli_tool\((.*)\)\)\.text$/s.exec(String(call.args.code))?.[1] ?? '{}'
    const result = onlyTool(h).definition.execute(JSON.parse(forwarded) as Record<string, unknown>, exec)
    await expect(result).resolves.toMatchObject({ text: 'Created out.txt' })
    expect(readFileSync(join(cwd, 'out.txt'), 'utf8')).toBe('hi\n')
  })

  it('refuses without starting the CLI when the PTC runtime cannot run the program', async () => {
    const h = harness()
    h.root.provide('ptcRuntime', { ...PTC_RUNTIME, language: 'python' })
    await start(h)
    addAgent(h, { preset: 'ptc' })
    openTurn(h, 'dsh-1', ['m1'])
    const stream = onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] }))
    await expect(collect(stream)).rejects.toMatchObject({ code: 'CLI_WRONG_PRESET' })
    expect(h.subprocess.spawned).toEqual([])
  })
})

describe('CliBridge git routes', () => {
  it('registers the git routes once the web server and connection are up, and drops them on dispose', async () => {
    const h = harness()
    const dispose = vi.fn()
    const register = vi.fn((_route: { kind: string; path: string }) => dispose)
    const fiber = await load(h)
    expect(register).not.toHaveBeenCalled()
    h.root.provide('webServer', { register })
    h.root.provide('connection', { requestRejection: () => undefined })
    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/dsh-ccgui/git' }))
    })
    await fiber.dispose()
    expect(dispose).toHaveBeenCalled()
  })
})
