import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { openStdioTransport } from '../src/stdio-transport.ts'
import type { AcpTransport } from '../src/transport.ts'
import { FakeSubprocess, type FakeSubprocessOptions } from './fixtures/fake-subprocess.ts'

const FAKE_AGENT = join(import.meta.dirname, 'fixtures', 'fake-acp-agent.mjs')

/** Minimal stand-in for the harness subprocess seam, over node:child_process. */
function spawnForTest(spec: SubprocessSpawnSpec): SubprocessHandle {
  const [command, ...args] = spec.argv
  const child = spawn(command as string, args, { cwd: spec.cwd, stdio: ['pipe', 'pipe', 'ignore'] })
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  const waitForExit = async (signal?: AbortSignal): Promise<boolean> => {
    const aborted = new Promise<boolean>((resolve) => {
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
    return Promise.race([
      done.then(
        () => true,
        () => true,
      ),
      aborted,
    ])
  }
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: undefined,
    control: undefined,
    collected: {},
    done,
    terminate: () => {
      child.kill('SIGKILL')
    },
    waitForExit,
  }
}

interface Harness {
  readonly transport: AcpTransport
  readonly updates: SessionUpdate[]
  readonly closed: Error[]
  readonly cwd: string
}

function open(
  argv: readonly string[] = [process.execPath, FAKE_AGENT],
  spawnChild: (spec: SubprocessSpawnSpec) => SubprocessHandle = spawnForTest,
): Harness {
  const updates: SessionUpdate[] = []
  const closed: Error[] = []
  const cwd = mkdtempSync(join(tmpdir(), 'ccgui-'))
  const transport = openStdioTransport(
    { argv, cwd, env: {}, graceMs: 200, eofGraceMs: 500, spawn: spawnChild },
    {
      onUpdate: (update) => updates.push(update),
      onPermission: () => Promise.resolve({ outcome: { outcome: 'selected', optionId: 'once' } }),
      onClosed: (error) => closed.push(error),
    },
  )
  return { transport, updates, closed, cwd }
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('openStdioTransport', () => {
  it('runs a turn and delivers every update before the turn ends', async () => {
    const { transport, updates, cwd } = open()
    const { agentCapabilities } = await transport.initialize()
    expect(agentCapabilities?.loadSession).toBe(true)
    const { sessionId } = await transport.newSession(cwd)
    await expect(transport.prompt(sessionId, text('hello'))).resolves.toEqual({
      stopReason: 'end_turn',
      usage: { totalTokens: 1200, inputTokens: 150, outputTokens: 50, cachedReadTokens: 1000 },
    })
    expect(updates.map((update) => update.sessionUpdate)).toEqual(['agent_thought_chunk', 'agent_message_chunk'])
    await transport.dispose()
  })

  it('answers permission requests through the handler', async () => {
    const { transport, updates, cwd } = open()
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    await transport.prompt(sessionId, text('WRITE out.txt'))
    expect(existsSync(join(cwd, 'out.txt'))).toBe(true)
    expect(updates.map((update) => update.sessionUpdate)).toContain('tool_call_update')
    await transport.dispose()
  })

  it('resumes and loads sessions', async () => {
    const { transport, cwd } = open()
    await transport.initialize()
    await expect(transport.resumeSession('old', cwd)).resolves.toBeDefined()
    await expect(transport.loadSession('old', cwd)).resolves.toBeDefined()
    await transport.dispose()
  })

  it('reports model options and switches between them', async () => {
    const { transport, updates, cwd } = open()
    await transport.initialize()
    const { sessionId, configOptions } = await transport.newSession(cwd)
    expect(configOptions?.map((option) => option.id)).toEqual(['model', 'mode'])
    const after = await transport.setConfigOption(sessionId, 'model', 'fake-large')
    expect(after?.[0]).toMatchObject({ currentValue: 'fake-large' })
    await transport.prompt(sessionId, text('WHICH MODEL'))
    expect(updates.at(-1)).toMatchObject({ content: { text: 'model=fake-large' } })
    await transport.dispose()
  })

  it('passes a native mode through as the id it was given', async () => {
    const { transport, updates, cwd } = open()
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    const after = await transport.setConfigOption(sessionId, 'mode', 'plan')
    expect(after?.find((option) => option.id === 'mode')).toMatchObject({ currentValue: 'plan' })
    await transport.prompt(sessionId, text('WHICH MODE'))
    expect(updates.at(-1)).toMatchObject({ content: { text: 'mode=plan' } })
    await transport.dispose()
  })

  it('deletes and closes sessions', async () => {
    const { transport, cwd } = open()
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    await expect(transport.closeSession(sessionId)).resolves.toBeUndefined()
    await expect(transport.deleteSession(sessionId)).resolves.toBeUndefined()
    await transport.dispose()
  })

  it('stops a running turn on cancel', async () => {
    const { transport, cwd } = open()
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    const turn = transport.prompt(sessionId, text('HANG'))
    transport.cancel(sessionId)
    await expect(turn).resolves.toMatchObject({ stopReason: 'cancelled' })
    await transport.dispose()
  })

  it('rejects the running turn and reports closure when the process exits', async () => {
    const { transport, closed, cwd } = open()
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    await expect(transport.prompt(sessionId, text('CRASH'))).rejects.toThrow('退出码 3')
    expect(closed).toHaveLength(1)
    expect(closed[0]?.message).toContain('退出码 3')
    await transport.dispose()
  })

  // The harness seam can report exit later than the pipe closes. The session must
  // still learn the connection is gone, or its next prompt reuses a dead pipe.
  it('reports closure from stdout when the exit status is slow to arrive', async () => {
    const slowDone = (spec: SubprocessSpawnSpec): SubprocessHandle =>
      ({
        ...spawnForTest(spec),
        done: new Promise(() => {}),
      }) as unknown as SubprocessHandle
    const { transport, closed, cwd } = open([process.execPath, FAKE_AGENT], slowDone)
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)
    await expect(transport.prompt(sessionId, text('CRASH'))).rejects.toThrow('连接已关闭')
    expect(closed).toHaveLength(1)
    await expect(transport.prompt(sessionId, text('again'))).rejects.toThrow('连接已关闭')
    await transport.dispose()
  })

  it('reports a command that cannot start', async () => {
    const { transport, closed } = open(['/nonexistent/ccgui-command'])
    await expect(transport.initialize()).rejects.toThrow(/ENOENT/)
    await expect.poll(() => closed.length).toBeGreaterThan(0)
    await transport.dispose()
  })

  it('terminates a process that ignores stdin closing', async () => {
    const { transport } = open([process.execPath, '-e', 'setInterval(() => {}, 1000)'])
    await expect(transport.dispose()).resolves.toBeUndefined()
  })

  it('stops a process at once when forced', async () => {
    const { transport } = open([process.execPath, '-e', 'setInterval(() => {}, 1000)'])
    const started = Date.now()
    await transport.dispose(true)
    expect(Date.now() - started).toBeLessThan(400)
  })

  it('survives a closed handler that throws', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ccgui-'))
    const transport = openStdioTransport(
      { argv: [process.execPath, FAKE_AGENT], cwd, env: {}, graceMs: 200, eofGraceMs: 500, spawn: spawnForTest },
      {
        onUpdate: () => {},
        onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
        onClosed: () => {
          throw new Error('handler bug')
        },
      },
    )
    await transport.initialize()
    await expect(transport.dispose()).resolves.toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('is safe to dispose twice', async () => {
    const { transport } = open()
    await transport.initialize()
    const first = transport.dispose()
    await expect(transport.dispose()).resolves.toBeUndefined()
    await first
  })
})

const EOF_GRACE_MS = 20

function openFake(options: FakeSubprocessOptions = {}): Harness & { readonly fake: FakeSubprocess } {
  const fake = new FakeSubprocess(options)
  const updates: SessionUpdate[] = []
  const closed: Error[] = []
  const cwd = '/work/project'
  const transport = openStdioTransport(
    {
      argv: ['agent', '--acp'],
      cwd,
      env: { TOKEN: 'secret' },
      graceMs: 200,
      eofGraceMs: EOF_GRACE_MS,
      spawn: fake.spawn,
    },
    {
      onUpdate: (update) => updates.push(update),
      onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
      onClosed: (error) => closed.push(error),
    },
  )
  return { transport, updates, closed, cwd, fake }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('openStdioTransport over a scripted subprocess', () => {
  // A refusal must be explained by this turn's log, not by a line a previous turn
  // left in the process-wide stderr tail.
  it('quotes only what the CLI wrote during this turn', async () => {
    const { transport, cwd, fake } = openFake({ exitOnEof: true })
    await transport.initialize()
    const { sessionId } = await transport.newSession(cwd)

    // Written before the turn starts: it belongs to no turn and must be dropped.
    fake.writeStderr('start-up noise\n')
    const first = transport.prompt(sessionId, text('hello'))
    fake.writeStderr('first turn: quota exceeded\n')
    expect((await first).stderr).toBe('first turn: quota exceeded')

    const second = transport.prompt(sessionId, text('hello'))
    fake.writeStderr('second turn: nothing useful\n')
    expect((await second).stderr).toBe('second turn: nothing useful')

    await transport.dispose()
  })

  it('asks the seam for piped protocol streams and the CLI environment', () => {
    const { fake } = openFake({ exitOnEof: true })
    expect(fake.spec).toEqual({
      argv: ['agent', '--acp'],
      cwd: '/work/project',
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } },
      graceMs: 200,
      env: { TOKEN: 'secret' },
    })
  })

  it.each(['stdin', 'stdout'] as const)('refuses a seam that drops the %s pipe', (omit) => {
    expect(() => openFake({ omit })).toThrow('subprocess implementation dropped a piped protocol stream')
  })

  it('sends every operation with its parameters', async () => {
    const { transport, fake } = openFake({ exitOnEof: true })
    await transport.initialize()
    await transport.newSession('/a')
    await transport.resumeSession('s1', '/b')
    await transport.loadSession('s2', '/c')
    await transport.setConfigOption('s1', 'model', 'big')
    await transport.deleteSession('s3')
    await transport.closeSession('s4')
    await expect(transport.prompt('s1', text('hi'))).resolves.toEqual({ stopReason: 'end_turn' })
    transport.cancel('s5')
    await expect.poll(() => fake.received.length).toBe(9)
    expect(fake.received.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } },
      { method: 'session/new', params: { cwd: '/a', mcpServers: [] } },
      { method: 'session/resume', params: { sessionId: 's1', cwd: '/b', mcpServers: [] } },
      { method: 'session/load', params: { sessionId: 's2', cwd: '/c', mcpServers: [] } },
      { method: 'session/set_config_option', params: { sessionId: 's1', configId: 'model', value: 'big' } },
      { method: 'session/delete', params: { sessionId: 's3' } },
      { method: 'session/close', params: { sessionId: 's4' } },
      { method: 'session/prompt', params: { sessionId: 's1', prompt: text('hi') } },
      { method: 'session/cancel', params: { sessionId: 's5' } },
    ])
    await transport.dispose()
  })

  // A request the CLI refuses must fail on its own; waiting for the connection to
  // close would hang the caller on a live process.
  it('rejects with the CLI error while the connection stays open', async () => {
    const { transport, closed, fake } = openFake({
      exitOnEof: true,
      respond: (message) =>
        message.method === 'session/new' ? { error: { code: -32602, message: 'bad cwd' } } : { result: {} },
    })
    await expect(transport.newSession('/a')).rejects.toThrow('bad cwd')
    expect(closed).toEqual([])
    expect(fake.terminations).toBe(0)
    await transport.dispose()
  })

  it('reports a process killed by a signal', async () => {
    const { transport, closed, fake } = openFake({ respond: () => undefined })
    const pending = transport.newSession('/a')
    fake.exitWith({ exitCode: null, signal: 'SIGTERM' })
    await expect(pending).rejects.toThrow('进程被信号 SIGTERM 终止')
    expect(closed.map((error) => error.message)).toEqual(['进程被信号 SIGTERM 终止'])
  })

  it('reports an exit code when the process exits normally', async () => {
    const { closed, fake } = openFake()
    fake.exitWith({ exitCode: 7, signal: null })
    await expect.poll(() => closed.map((error) => error.message)).toEqual(['进程退出，退出码 7'])
  })

  // From a Windows report: npx found a half-installed cache entry and died before the
  // protocol began, so stderr is the only place the reason was ever written.
  it('quotes the end of stderr and the signed exit code when the process dies', async () => {
    const { transport, closed, fake } = openFake()
    const started = transport.initialize()
    fake.writeStderr(
      [
        'npm error code ENOENT',
        'npm error path C:\\Program Files\\nodejs\\node_cache\\_npx\\928bb229ebc08fcf\\package.json',
        'npm error enoent Could not read package.json',
      ].join('\n'),
    )
    fake.exitWith({ exitCode: 4_294_963_238, signal: null })
    await expect(started).rejects.toThrow('退出码 4294963238（即 -4058）')
    const [reason] = closed
    expect(reason?.message).toContain('npm error code ENOENT')
    expect(reason?.message).toContain('_npx\\928bb229ebc08fcf')
  })

  it('keeps only the end of a long stderr and says nothing when it is empty', async () => {
    const quiet = openFake()
    quiet.fake.exitWith({ exitCode: 7, signal: null })
    await expect.poll(() => quiet.closed.map((error) => error.message)).toEqual(['进程退出，退出码 7'])
    const noisy = openFake()
    noisy.fake.writeStderr(`${'x'.repeat(2000)}\nlast line`)
    noisy.fake.exitWith({ exitCode: 1, signal: null })
    await expect.poll(() => noisy.closed).toHaveLength(1)
    const [reason] = noisy.closed
    expect(reason?.message).toContain('last line')
    expect(reason?.message.length).toBeLessThan(1000)
  })

  it('passes a seam failure through unchanged', async () => {
    const { closed, fake } = openFake()
    const failure = new Error('spawn agent ENOENT')
    fake.fail(failure)
    await expect.poll(() => closed).toEqual([failure])
    expect(closed[0]).toBe(failure)
  })

  it('wraps a seam failure that is not an Error', async () => {
    const { closed, fake } = openFake()
    fake.fail('provider gone')
    await expect.poll(() => closed.length).toBe(1)
    expect(closed[0]).toBeInstanceOf(Error)
    expect(closed[0]?.message).toBe('provider gone')
  })

  it('lets a CLI that exits on stdin EOF stop without a signal', async () => {
    const { transport, fake } = openFake({ exitOnEof: true })
    await transport.dispose()
    expect(fake.stdin.writableEnded).toBe(true)
    expect(fake.terminations).toBe(0)
    expect(fake.waitSignals).toHaveLength(1)
    // The grace timer must be cleared once the CLI has exited, not fire later.
    await settle(EOF_GRACE_MS * 3)
    expect(fake.waitSignals[0]?.aborted).toBe(false)
  })

  it('terminates a CLI that outlives the EOF grace period', async () => {
    const { transport, fake } = openFake()
    await transport.dispose()
    expect(fake.stdin.writableEnded).toBe(true)
    expect(fake.terminations).toBe(1)
    expect(fake.waitSignals).toHaveLength(2)
    expect(fake.waitSignals[0]?.aborted).toBe(true)
    expect(fake.waitSignals[1]).toBeUndefined()
  })

  it('terminates when the seam cannot observe the graceful exit', async () => {
    const { transport, fake } = openFake({ exitOnEof: true, failFirstWait: true })
    await transport.dispose()
    expect(fake.terminations).toBe(1)
  })

  it('terminates at once when forced, even for a CLI that would exit on EOF', async () => {
    const { transport, fake } = openFake({ exitOnEof: true })
    await transport.dispose(true)
    expect(fake.terminations).toBe(1)
  })

  it('shares one disposal between calls', async () => {
    const { transport, fake } = openFake()
    await Promise.all([transport.dispose(), transport.dispose()])
    expect(fake.terminations).toBe(1)
    expect(fake.waitSignals).toHaveLength(2)
  })

  // A late EPIPE from a CLI that is exiting must not surface as an uncaught error.
  it('swallows a write error on stdin after the pipe has finished', async () => {
    const { transport, fake } = openFake({ exitOnEof: true })
    await transport.dispose()
    expect(() => fake.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
  })
})
