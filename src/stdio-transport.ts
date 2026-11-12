/**
 * ACP over a child process's stdio, using the harness subprocess seam so the CLI
 * gets the shared credential scrub and managed teardown. Process teardown and SDK
 * wiring are adapted from `@deepseek-ai/dsh-subagent-acp`; see THIRD_PARTY_NOTICES.md.
 * @module dsh-ccgui/stdio-transport
 */

import { Readable, Writable } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { AcpTransport, TransportHandlers } from './transport.ts'

/** How to start one CLI. */
export interface StdioTransportSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  /** Added to the seam's scrubbed environment; the place for a CLI's own credentials. */
  readonly env: Readonly<Record<string, string>>
  /** Signal-escalation grace in milliseconds. */
  readonly graceMs: number
  /** Time after stdin EOF for the CLI to flush and exit by itself, in milliseconds. */
  readonly eofGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/** How long a closed pipe waits for the exit status before failing without it. */
const CLOSE_REASON_WAIT_MS = 1_000
/**
 * stderr is collected rather than inherited: a CLI that dies before the protocol starts,
 * such as `npx` on a half-installed cache entry, writes its reason only there, and the
 * harness's own stderr is nowhere the user looks. The seam keeps the tail of this size.
 */
const STDERR_TAIL_BYTES = 4_096
/** How much of that tail goes into the error shown to the user. */
const QUOTED_STDERR_CHARS = 800
/** Windows reports a negative exit code as unsigned; npm and libuv print the signed one. */
const UNSIGNED_EXIT_FROM = 0x80_00_00_00
const UNSIGNED_EXIT_RANGE = 0x1_00_00_00_00

function exitCodeText(exitCode: number | null): string {
  if (exitCode === null || exitCode < UNSIGNED_EXIT_FROM) return String(exitCode)
  return `${exitCode}（即 ${exitCode - UNSIGNED_EXIT_RANGE}）`
}

function stderrTail(child: SubprocessHandle): string {
  const text = child.collected.stderr?.readFrom(0).text.trim() ?? ''
  return text.length > QUOTED_STDERR_CHARS ? text.slice(-QUOTED_STDERR_CHARS) : text
}

/**
 * stderr belongs to a turn, not to the process. A tail read when one prompt ends
 * must not quote what an earlier turn left behind — that would explain a refusal
 * with somebody else's log line. Offsets are owned here, so the batch read used
 * for an exit reason stays independent.
 */
interface TurnStderr {
  /** Start a turn: everything written before it is no longer this turn's evidence. */
  mark(): void
  /** @returns what the CLI wrote during this turn. */
  take(): string
}

function turnStderr(child: SubprocessHandle): TurnStderr {
  const read = child.collected.stderr
  let offset = 0
  const advance = (): string => {
    if (read === undefined) return ''
    const { text, nextOffset } = read.readFrom(offset)
    offset = nextOffset
    return text.trim()
  }
  return {
    mark: () => {
      advance()
    },
    take: () => {
      const text = advance()
      return text.length > QUOTED_STDERR_CHARS ? text.slice(-QUOTED_STDERR_CHARS) : text
    },
  }
}

function describeExit(outcome: SubprocessOutcome, stderr: string): string {
  const exit =
    outcome.signal === null ? `进程退出，退出码 ${exitCodeText(outcome.exitCode)}` : `进程被信号 ${outcome.signal} 终止`
  return stderr === '' ? exit : `${exit}。它退出前的输出：${stderr}`
}

async function exitsWithin(child: SubprocessHandle, ms: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, ms)
  try {
    return await child.waitForExit(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Stdin EOF gives the CLI a chance to flush its session before any signal. */
async function stopChild(child: SubprocessHandle, eofGraceMs: number): Promise<void> {
  child.stdin?.end()
  if (await exitsWithin(child, eofGraceMs).catch(() => false)) return
  child.terminate()
  await child.waitForExit()
}

/** Prefer the exit status over a bare closed pipe, but do not hold up the failure for it. */
function closeReason(child: SubprocessHandle): Promise<Error> {
  const timeout = new Promise<Error>((resolve) => {
    setTimeout(() => {
      resolve(new Error('连接已关闭'))
    }, CLOSE_REASON_WAIT_MS).unref()
  })
  const exit = child.done.then(
    (outcome) => new Error(describeExit(outcome, stderrTail(child))),
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  )
  return Promise.race([exit, timeout])
}

function spawnChild(spec: StdioTransportSpec): SubprocessHandle {
  const child = spec.spawn({
    argv: spec.argv,
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: STDERR_TAIL_BYTES } },
    graceMs: spec.graceMs,
    env: { ...spec.env },
  })
  if (child.stdin === undefined || child.stdout === undefined) {
    throw new Error('subprocess implementation dropped a piped protocol stream')
  }
  // A write racing the CLI's exit raises EPIPE here; the exit itself is reported through `done`.
  child.stdin.on('error', () => {
    /* EPIPE; the exit itself is reported through done */
  })
  return child
}

type UntilClosed = <T>(request: Promise<T>) => Promise<T>

/**
 * Watch for the end of the connection. A closed stdout ends the protocol for good, and it
 * can arrive well before the subprocess seam reports the exit. Call this ahead of connecting
 * so the reader registered here runs before the SDK's own, and `closing` is set by the time
 * the SDK rejects the requests in flight.
 * @returns a wrapper making a request reject once the connection is gone.
 */
function watchClose(child: SubprocessHandle, handlers: TransportHandlers): UntilClosed {
  const closed = Promise.withResolvers<never>()
  closed.promise.catch(() => {
    /* only keeps the rejection observed; untilClosed is the real consumer */
  })
  let closing: Promise<void> | undefined
  const beginClose = (): void => {
    closing ??= closeReason(child)
      .then((error) => {
        closed.reject(error)
        handlers.onClosed(error)
      })
      .catch(() => {
        // Requests already reject through `closed`. An unhandled rejection here would
        // take the whole harness down, which a handler bug must not do.
      })
  }
  child.stdout?.once('end', beginClose)
  child.done.then(beginClose, beginClose)
  // Once the connection is going down, callers get its reason instead of the
  // SDK's generic error, and `onClosed` has run before their rejection arrives.
  return (request) =>
    Promise.race([request, closed.promise]).catch(async (error: unknown) => {
      if (closing !== undefined) await closed.promise
      throw error
    })
}

function connectAgent(child: SubprocessHandle, handlers: TransportHandlers) {
  return client({ name: 'dsh-ccgui' })
    .onNotification(methods.client.session.update, ({ params }) => {
      handlers.onUpdate(params.update)
      return Promise.resolve()
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => handlers.onPermission(params))
    .connect(
      ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      ),
    ).agent
}

function sessionOperations(
  agent: ReturnType<typeof connectAgent>,
  untilClosed: UntilClosed,
  turnLog: TurnStderr,
): Omit<AcpTransport, 'initialize' | 'dispose'> {
  const { session } = methods.agent
  return {
    newSession: (cwd) => untilClosed(agent.request(session.new, { cwd, mcpServers: [] })),
    resumeSession: async (sessionId, cwd) => {
      const { configOptions } = await untilClosed(agent.request(session.resume, { sessionId, cwd, mcpServers: [] }))
      return configOptions
    },
    loadSession: async (sessionId, cwd) => {
      const { configOptions } = await untilClosed(agent.request(session.load, { sessionId, cwd, mcpServers: [] }))
      return configOptions
    },
    setConfigOption: async (sessionId, configId, value) => {
      const { configOptions } = await untilClosed(
        agent.request(session.setConfigOption, { sessionId, configId, value }),
      )
      return configOptions
    },
    deleteSession: async (sessionId) => {
      await untilClosed(agent.request(session.delete, { sessionId }))
    },
    closeSession: async (sessionId) => {
      await untilClosed(agent.request(session.close, { sessionId }))
    },
    prompt: async (sessionId, blocks) => {
      turnLog.mark()
      const answer = await untilClosed(agent.request(session.prompt, { sessionId, prompt: [...blocks] }))
      const { stopReason, usage, _meta } = answer
      // Read this turn only: the process may be replaced before anyone looks at
      // the failure, and a previous turn's log is no explanation for this one.
      // Nothing is added when there is nothing to add, so a plain turn keeps its
      // plain outcome.
      const stderr = turnLog.take()
      return {
        stopReason,
        usage,
        ...(_meta == null ? {} : { meta: _meta }),
        ...(stderr === '' ? {} : { stderr }),
      }
    },
    cancel: (sessionId) => {
      // Best effort: if the process is already gone, `closed` has reported it.
      agent.notify(session.cancel, { sessionId }).catch(() => {
        /* a gone process is reported by closed */
      })
    },
  }
}

/**
 * Start a CLI and connect to it. The returned operations reject once the process
 * is gone, because a request the CLI will never answer would otherwise hang.
 * @param spec - the command and its process settings.
 * @param handlers - callbacks from the CLI.
 * @returns the connected transport.
 */
export function openStdioTransport(spec: StdioTransportSpec, handlers: TransportHandlers): AcpTransport {
  const child = spawnChild(spec)
  const untilClosed = watchClose(child, handlers)
  const agent = connectAgent(child, handlers)
  let disposal: Promise<void> | undefined

  return {
    // No client capabilities are advertised: the CLI keeps using its own file
    // system and terminal, and the harness only observes what it reports.
    initialize: () =>
      untilClosed(
        agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
      ),
    ...sessionOperations(agent, untilClosed, turnStderr(child)),
    dispose: (force = false) => {
      if (force) child.terminate()
      return (disposal ??= stopChild(child, spec.eofGraceMs))
    },
  }
}
