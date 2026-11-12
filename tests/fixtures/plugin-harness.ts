/**
 * The harness stand-in the plugin tests load `CliBridge` into: fake `llm`, `tools`,
 * `agents`, `subprocess` and preset services, plus helpers to add agents, open turns and
 * build requests. Each test file still mocks `node:os` itself, since a mock is per file.
 * @module tests/fixtures/plugin-harness
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber, Message } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmAdapter, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import CliBridge from '../../src/index.ts'
import type { CliAgentConfig, Config } from '../../src/index.ts'
import { DEFAULT_MODEL_ID } from '../../src/constants.ts'
import { NodeSubprocess } from './node-subprocess.ts'

export const FAKE_AGENT = join(import.meta.dirname, 'fake-acp-agent.mjs')
export const WAIT = { timeout: 10_000 }

export const FAKE: CliAgentConfig = {
  id: 'fake',
  name: 'Fake CLI',
  command: process.execPath,
  args: [FAKE_AGENT],
  env: {},
}
/** Never answers, so a probe of it stays in flight until it is aborted. */
export const SILENT: CliAgentConfig = {
  id: 'silent',
  name: 'Silent CLI',
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  env: {},
}
/** Exits before speaking ACP, so starting it fails. */
export const BROKEN: CliAgentConfig = {
  id: 'broken',
  name: 'Broken CLI',
  command: process.execPath,
  args: ['-e', 'process.exit(2)'],
  env: {},
}

/** Type a partial stand-in for a harness object; only the fields the plugin reads are set. */
export const fake = <T>(fields: Partial<T>): T => fields as T
export const sid = (id: string): SessionId => id as SessionId

interface Registration {
  readonly definition: ToolDefinition
  readonly options: ToolRegistrationOptions | undefined
}

interface ReviewMock {
  /** Providers the harness advertises besides the CLIs. */
  providers: string[]
  /** Models each of those providers advertises, in order. */
  models: Record<string, string[]>
  /** Providers whose model catalog cannot be read, to exercise the fallback. */
  failModels: string[]
  /** Requests the plugin forwarded to a stateless route. */
  requests: GenerateOptions[]
}

export interface Harness {
  readonly root: Context
  readonly subprocess: NodeSubprocess
  readonly adapters: { providers: string[]; adapter: LlmAdapter }[]
  readonly tools: Registration[]
  readonly agents: Map<string, Agent>
  readonly presets: Map<Context, string>
  readonly logs: Message[]
  readonly modelUpdates: string[]
  readonly dshHome: string
  readonly review: ReviewMock
}

export const REVIEW_FINISH: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

interface FakeAgent {
  readonly agent: Agent
  readonly select: ReturnType<typeof vi.fn>
}

export function harness({ homePath = true }: { homePath?: boolean } = {}): Harness {
  const root = new Context()
  const subprocess = new NodeSubprocess()
  const adapters: Harness['adapters'] = []
  const tools: Registration[] = []
  const agents = new Map<string, Agent>()
  const presets = new Map<Context, string>()
  const logs: Message[] = []
  const modelUpdates: string[] = []
  const review: ReviewMock = { providers: [], models: {}, failModels: [], requests: [] }
  const dshHome = mkdtempSync(join(tmpdir(), 'ccgui-home-'))
  root.logger.exporter({ export: (message) => logs.push(message) })
  root.on('llm/models-updated', (provider) => modelUpdates.push(provider))
  root.provide('llm', {
    registerAdapter: (providers: string[], adapter: LlmAdapter) => {
      adapters.push({ providers, adapter })
      return () => undefined
    },
    listProviders: () => review.providers.map((id) => ({ id, name: id })),
    listModels: (provider: string) =>
      review.failModels.includes(provider)
        ? Promise.reject(new Error('catalog unavailable'))
        : Promise.resolve((review.models[provider] ?? []).map((id) => ({ provider, id, name: id }))),
    stream: (options: GenerateOptions) => {
      review.requests.push(options)
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield REVIEW_FINISH
      })()
    },
  })
  root.provide('tools', {
    register: (definition: ToolDefinition, options?: ToolRegistrationOptions) => {
      tools.push({ definition, options })
      return () => undefined
    },
  })
  root.provide('agents', { get: (id: string) => agents.get(id) })
  root.provide('subprocess', { spawn: subprocess.spawn.bind(subprocess) })
  root.provide('agentPresets', { composedPreset: (ctx: Context) => presets.get(ctx) })
  if (homePath) root.provide('dshHomePath', (...segments: string[]) => join(dshHome, ...segments))
  return { root, subprocess, adapters, tools, agents, presets, logs, modelUpdates, dshHome, review }
}

export function addAgent(
  h: Harness,
  { id = 'dsh-1', preset, cwd }: { id?: string; preset?: string; cwd?: string } = {},
): FakeAgent {
  const agentCtx = fake<Context>({})
  if (preset !== undefined) h.presets.set(agentCtx, preset)
  let current: { provider: string; model: string } | undefined
  const select = vi.fn((selection: { provider: string; model: string }) => {
    current = selection
  })
  const agent = fake<Agent>({
    id: sid(id),
    ctx: agentCtx,
    session: fake<Session>({ header: fake<SessionHeader>({ cwd: cwd ?? mkdtempSync(join(tmpdir(), 'ccgui-')) }) }),
    model: fake<Agent['model']>({ select, current: () => current }),
  })
  h.agents.set(id, agent)
  return { agent, select }
}

export const BASE: Config = {
  agents: [FAKE],
  disposeGraceMs: 200,
  disposeEofGraceMs: 500,
  cancelGraceMs: 200,
  startTimeoutMs: 10_000,
  reviewProvider: '',
  reviewModel: '',
}

export async function load(h: Harness, config: Partial<Config> = {}): Promise<Fiber> {
  const fiber = h.root.plugin(CliBridge, { ...BASE, ...config })
  await fiber
  return fiber
}

export const warnings = (h: Harness): string[] =>
  h.logs.filter((message) => message.type === 'warn').map((message) => String(message.args[0]))

export function onlyAdapter(h: Harness): LlmAdapter {
  const [entry] = h.adapters
  if (entry === undefined) throw new Error('no adapter registered')
  return entry.adapter
}

export function onlyTool(h: Harness): Registration {
  const [entry] = h.tools
  if (entry === undefined) throw new Error('no tool registered')
  return entry
}

/** This SDK types `purpose` as always undefined; newer hosts do send it. */
type RequestFields = Omit<Partial<GenerateOptions>, 'purpose'> & { purpose?: string }

export const request = (fields: RequestFields): GenerateOptions =>
  Object.assign(
    {},
    fake<GenerateOptions>({
      provider: 'cli-fake',
      model: DEFAULT_MODEL_ID,
      messages: [],
      sessionId: sid('dsh-1'),
    }),
    fields,
  )

export function emitSessionEvent(h: Harness, sessionId: string, event: { type: string; data?: unknown }): void {
  h.root.emit('session/event', fake<Session>({ id: sid(sessionId) }), event as SessionEvent)
}

/** Mark `ids` as the open turn's new user messages, as the harness log would. */
export function openTurn(h: Harness, sessionId: string, ids: readonly string[]): void {
  emitSessionEvent(h, sessionId, { type: 'turn/start' })
  for (const id of ids) emitSessionEvent(h, sessionId, { type: 'user/message', data: { id } })
}

let disposers: (() => Promise<void>)[] = []

/** Load the plugin and make sure its processes are gone after the test. */
export async function start(h: Harness, config: Partial<Config> = {}): Promise<Fiber> {
  const fiber = await load(h, config)
  disposers = [
    ...disposers,
    async () => {
      await fiber.dispose()
      await h.subprocess.allExited()
    },
  ]
  return fiber
}

/** Stop every plugin `start` loaded; call it after each test. */
export async function stopStarted(): Promise<void> {
  await Promise.all(disposers.map((dispose) => dispose()))
  disposers = []
}
