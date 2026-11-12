import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { collect, user } from './fixtures/cli-session-helpers.ts'
import {
  REVIEW_FINISH,
  addAgent,
  emitSessionEvent,
  harness,
  onlyAdapter,
  openTurn,
  request,
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

describe('CliBridge auto-review routing', () => {
  // Reviewer calls arrive stamped with the main agent's CLI route. They must reach
  // a stateless model with the policy intact, never a `session/prompt` in the CLI.
  it('forwards the reviewer to the configured route with its request intact', async () => {
    const h = harness()
    h.review.providers = ['cli-fake', 'deepseek']
    await start(h, { reviewProvider: 'deepseek', reviewModel: 'deepseek-chat' })
    const options = request({
      purpose: 'auto-review',
      system: 'REVIEW_POLICY',
      temperature: 0,
      messages: [user('m1', 'history')],
    })
    await expect(collect(onlyAdapter(h).stream(options))).resolves.toEqual([REVIEW_FINISH])
    expect(h.review.requests).toHaveLength(1)
    expect(h.review.requests[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      system: 'REVIEW_POLICY',
      temperature: 0,
      purpose: 'auto-review',
    })
    expect(h.subprocess.spawned).toEqual([])
  })

  // The review carries the conversation. Sending it to whichever provider happens to be
  // listed first would hand the user's code to a vendor, and a bill, they never chose.
  it('picks no reviewer on its own, even when another provider is there', async () => {
    const h = harness()
    h.review.providers = ['cli-fake', 'deepseek']
    h.review.models = { deepseek: ['deepseek-chat'] }
    await start(h)
    await expect(collect(onlyAdapter(h).stream(request({ purpose: 'auto-review' })))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
      message: /reviewProvider/,
    })
    expect(h.review.requests).toEqual([])
    expect(h.subprocess.spawned).toEqual([])
  })

  it("uses the configured provider's first model when no model is set", async () => {
    const h = harness()
    h.review.models = { deepseek: ['deepseek-chat', 'deepseek-reasoner'] }
    await start(h, { reviewProvider: 'deepseek' })
    await collect(onlyAdapter(h).stream(request({ purpose: 'auto-review' })))
    expect(h.review.requests[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  // A CLI route would hand the review straight back to this adapter, which would hand it
  // back again, without end.
  it.each(['cli-fake', 'cli-not-configured'])('refuses %s as the review route', async (reviewProvider) => {
    const h = harness()
    await start(h, { reviewProvider, reviewModel: 'default' })
    await expect(collect(onlyAdapter(h).stream(request({ purpose: 'auto-review' })))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
      message: /CLI/,
    })
    expect(h.review.requests).toEqual([])
    expect(h.subprocess.spawned).toEqual([])
  })

  // A reasoning level belongs to the CLI's model; the harness rejects a level the reviewer's
  // model does not offer, so the reviewer runs at its own default instead.
  it("leaves the CLI model's reasoning level behind", async () => {
    const h = harness()
    await start(h, { reviewProvider: 'deepseek', reviewModel: 'deepseek-chat' })
    await collect(
      onlyAdapter(h).stream(request({ purpose: 'auto-review', reasoningEffort: ReasoningEffortId('xhigh') })),
    )
    expect(h.review.requests[0]).not.toHaveProperty('reasoningEffort')
  })

  it('reports a missing route when the configured provider cannot list models', async () => {
    const h = harness()
    h.review.failModels = ['configured']
    await start(h, { reviewProvider: 'configured' })
    const options = request({ purpose: 'auto-review' })
    await expect(collect(onlyAdapter(h).stream(options))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
      message: /审查模型/,
    })
    expect(warnings(h).some((text) => text.includes('could not list models for configured'))).toBe(true)
    expect(h.subprocess.spawned).toEqual([])
  })

  // A harness permission preset is not a CLI mode: the CLI still starts and runs its
  // own turn, and its native modes decide whether it asks for permission at all.
  it.each(['auto', 'danger-full-access'])('runs a CLI turn after a %s preset event', async (preset) => {
    const h = harness()
    h.review.providers = ['deepseek']
    h.review.models = { deepseek: ['deepseek-chat'] }
    await start(h)
    addAgent(h)
    emitSessionEvent(h, 'dsh-1', { type: 'permission/preset', data: { preset } })
    openTurn(h, 'dsh-1', ['m1'])
    await expect(collect(onlyAdapter(h).stream(request({ messages: [user('m1', 'hello')] })))).resolves.toBeDefined()
    expect(h.subprocess.spawned).toHaveLength(1)
  })
})
