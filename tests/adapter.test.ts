import { describe, expect, it, vi } from 'vitest'
import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CliBridgeAdapter, DEFAULT_MODEL_ID } from '../src/adapter.ts'
import type { CliSession } from '../src/cli-session.ts'
import type { PtcWrap } from '../src/session/ptc-call.ts'

const FINISH: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
const LEVELS = { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('high') }
const CURRENT_TURN: ReadonlySet<string> = new Set(['m1'])

function setup(ptcWrapFor: (provider: string, sessionId: string) => PtcWrap | undefined = () => undefined) {
  const stream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield FINISH
  })
  const auxiliaryStream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield FINISH
  })
  const resolveSession = vi.fn((_provider: string, _sessionId: string) => ({ stream }) as unknown as CliSession)
  const adapter = new CliBridgeAdapter({
    labelFor: (provider) => (provider === 'cli-x' ? 'X CLI' : undefined),
    resolveSession,
    ptcWrapFor: vi.fn(ptcWrapFor),
    currentTurnMessageIds: () => CURRENT_TURN,
    modelsFor: (provider) => [
      { provider, id: DEFAULT_MODEL_ID, name: 'Small（默认）' },
      { provider, id: 'large', name: 'Large' },
    ],
    modelName: (_provider, model) => (model === 'large' ? 'Large' : model),
    reasoningFor: (_provider, model) => (model === 'large' ? LEVELS : undefined),
    auxiliaryStream,
  })
  return { adapter, stream, resolveSession, auxiliaryStream }
}

/** This SDK types `purpose` as always undefined; newer hosts do send it. */
type RequestFields = Omit<Partial<GenerateOptions>, 'purpose'> & { purpose?: string }

const request = (fields: RequestFields = {}): GenerateOptions =>
  ({
    provider: 'cli-x',
    model: DEFAULT_MODEL_ID,
    messages: [],
    sessionId: 'dsh-1',
    ...fields,
  }) as GenerateOptions

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('CliBridgeAdapter catalog', () => {
  it('names the provider after the CLI', () => {
    expect(setup().adapter.providerInfo('cli-x')).toEqual({ id: 'cli-x', name: 'X CLI' })
  })

  it('falls back to the route for an unknown provider', () => {
    expect(setup().adapter.providerInfo('other')).toEqual({ id: 'other', name: 'other' })
  })

  it('offers the models the CLI reported', async () => {
    await expect(setup().adapter.listModels('cli-x')).resolves.toEqual([
      { provider: 'cli-x', id: DEFAULT_MODEL_ID, name: 'Small（默认）' },
      { provider: 'cli-x', id: 'large', name: 'Large' },
    ])
  })

  // The harness checks a chosen level against this before the request reaches the adapter.
  it('declares the levels of a resolved model', async () => {
    await expect(setup().adapter.resolveModel('cli-x', 'large')).resolves.toMatchObject({ reasoning: LEVELS })
    await expect(setup().adapter.resolveModel('cli-x', DEFAULT_MODEL_ID)).resolves.not.toHaveProperty('reasoning')
  })

  it('names a resolved model', async () => {
    await expect(setup().adapter.resolveModel('cli-x', 'large')).resolves.toMatchObject({ id: 'large', name: 'Large' })
  })

  // Undeclared context makes a switch to this route fail with
  // MODEL_SWITCH_COMPACTION_FAILED, and a small value would start compacting a
  // history the CLI never reads. The CLI manages its own context.
  it('declares a context window large enough that compaction never triggers', async () => {
    const info = await setup().adapter.resolveModel('cli-x', DEFAULT_MODEL_ID)
    expect(info.context?.contextWindow).toBeGreaterThanOrEqual(1_000_000_000)
    expect(Number.isSafeInteger(info.context?.contextWindow)).toBe(true)
  })

  // Retrying would send the same prompt to a CLI that may already have acted on it.
  it('disables retries', () => {
    expect(setup().adapter.providerRetryPolicy('cli-x')).toMatchObject({ mode: 'normal', maxRetries: 0 })
  })
})

describe('CliBridgeAdapter.stream', () => {
  it('forwards messages and the signal to the session', async () => {
    const { adapter, stream, resolveSession } = setup()
    const signal = new AbortController().signal
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] as GenerateOptions['messages']
    await expect(collect(adapter.stream(request({ messages, signal, model: 'large' })))).resolves.toEqual([FINISH])
    expect(resolveSession).toHaveBeenCalledWith('cli-x', 'dsh-1')
    expect(stream).toHaveBeenCalledWith({ messages, signal, model: 'large', currentTurnMessageIds: CURRENT_TURN })
  })

  it('forwards the chosen reasoning level', async () => {
    const { adapter, stream } = setup()
    await collect(adapter.stream(request({ model: 'large', reasoningEffort: ReasoningEffortId('high') })))
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'high' }))
  })

  it('tells the session to wrap its tool calls in a PTC session', async () => {
    const { adapter, stream } = setup(() => ({ timeoutMs: 600_000 }))
    await collect(adapter.stream(request()))
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ ptc: { timeoutMs: 600_000 } }))
  })

  // Checked before the session is resolved, so a CLI that cannot run here is never started.
  it('refuses before starting the CLI when the PTC runtime cannot host it', async () => {
    const { adapter, resolveSession } = setup(() => {
      throw new LlmError('no', 'CLI_WRONG_PRESET')
    })
    await expect(collect(adapter.stream(request()))).rejects.toMatchObject({ code: 'CLI_WRONG_PRESET' })
    expect(resolveSession).not.toHaveBeenCalled()
  })

  it('refuses a request with no session', async () => {
    const { adapter, resolveSession } = setup()
    const options = { provider: 'cli-x', model: DEFAULT_MODEL_ID, messages: [] } as GenerateOptions
    await expect(collect(adapter.stream(options))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    expect(resolveSession).not.toHaveBeenCalled()
  })

  // Summaries and titles expect a stateless model call. Sending one to the CLI
  // would inject it into the user's real conversation.
  it('refuses auxiliary requests', async () => {
    const { adapter, resolveSession } = setup()
    const options = request({ purpose: 'compaction' })
    await expect(collect(adapter.stream(options))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
      message: 'CLI 会话不支持辅助模型请求（compaction）。',
    })
    expect(resolveSession).not.toHaveBeenCalled()
  })

  // Auto review sends its reviewer request on the main agent's route. Send it to
  // a stateless model instead: forwarding it to the CLI would turn the review
  // history into a real user prompt.
  it('routes the Auto reviewer to a stateless model instead of the CLI', async () => {
    const { adapter, resolveSession, auxiliaryStream } = setup()
    const options = request({ purpose: 'auto-review', system: 'REVIEW_POLICY' })
    await expect(collect(adapter.stream(options))).resolves.toEqual([FINISH])
    expect(auxiliaryStream).toHaveBeenCalledWith(options)
    expect(resolveSession).not.toHaveBeenCalled()
  })
})
