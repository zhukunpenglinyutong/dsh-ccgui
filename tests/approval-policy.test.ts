import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CliAskPolicy } from '../src/session/approval-policy.ts'
import type { PolicyHolder } from '../src/session/approval-policy.ts'

type Policy = 'ask' | 'never'

interface Recorded {
  readonly type: string
  readonly data: unknown
}

interface Fixture {
  readonly agent: Agent
  readonly events: Recorded[]
  /** Reads the session's override the way the approval service does: the last policy event wins. */
  readonly holder: PolicyHolder
}

const policyOf = (event: Recorded | undefined): Policy | undefined =>
  (event?.data as { policy?: Policy } | undefined)?.policy

/** A session that records what gets appended to it, and an approval service that reads it back. */
function fixture(initial: Policy | undefined, { failRestore = false } = {}): Fixture {
  const events: Recorded[] = []
  const session = {
    append: (type: string, data: unknown) => {
      if (failRestore && policyOf({ type, data }) === 'never') throw new Error('session closed')
      events.push({ type, data })
    },
  }
  const holder: PolicyHolder = {
    overrideOf: () => policyOf(events.filter(({ type }) => type === 'approval/policy').at(-1)) ?? initial,
  }
  return { agent: { session } as unknown as Agent, events, holder }
}

const policies = (events: readonly Recorded[]): (Policy | undefined)[] => events.map(policyOf)

/** An ask that stays open until released, so tests can look at the stance while it waits. */
function openAsk(): { promise: Promise<string>; answer: (value: string) => void } {
  const { promise, resolve } = Promise.withResolvers<string>()
  return { promise, answer: resolve }
}

// DSH's access mode is for sessions the harness runs. A CLI session decides for itself
// whether to ask, and a "never ask" stance would answer its question with a rejection
// without asking anyone. The user's own setting must survive the CLI's questions.
describe('CliAskPolicy', () => {
  it('lifts a never-ask stance while the CLI asks, and puts it back afterwards', async () => {
    const { agent, events, holder } = fixture('never')
    const seen: (Policy | undefined)[] = []
    const answer = await new CliAskPolicy(vi.fn()).asking(holder, agent, () => {
      seen.push(holder.overrideOf?.(agent.session))
      return Promise.resolve('allowed-once')
    })
    expect(answer).toBe('allowed-once')
    expect(seen).toEqual(['ask'])
    expect(events.every(({ type }) => type === 'approval/policy')).toBe(true)
    expect(policies(events)).toEqual(['ask', 'never'])
    expect(holder.overrideOf?.(agent.session)).toBe('never')
  })

  it('lifts once for questions that overlap, and restores when the last one settles', async () => {
    const { agent, events, holder } = fixture('never')
    const policy = new CliAskPolicy(vi.fn())
    const first = openAsk()
    const second = openAsk()
    const one = policy.asking(holder, agent, () => first.promise)
    const two = policy.asking(holder, agent, () => second.promise)
    first.answer('allowed-once')
    await one
    expect(policies(events)).toEqual(['ask'])
    second.answer('rejected')
    await two
    expect(policies(events)).toEqual(['ask', 'never'])
  })

  it('puts the stance back when the question fails', async () => {
    const { agent, events, holder } = fixture('never')
    const asking = new CliAskPolicy(vi.fn()).asking(holder, agent, () => Promise.reject(new Error('no turn')))
    await expect(asking).rejects.toThrow('no turn')
    expect(policies(events)).toEqual(['ask', 'never'])
  })

  // Someone may change the stance while the CLI waits; that change stands.
  it('leaves a stance set to never-ask meanwhile as it is', async () => {
    const { agent, events, holder } = fixture('never')
    await new CliAskPolicy(vi.fn()).asking(holder, agent, () => {
      agent.session.append('approval/policy', { policy: 'never' })
      return Promise.resolve('cancelled')
    })
    expect(policies(events)).toEqual(['ask', 'never'])
  })

  it('reports a stance it could not put back, without failing the question', async () => {
    const { agent, holder } = fixture('never', { failRestore: true })
    const warn = vi.fn()
    await expect(new CliAskPolicy(warn).asking(holder, agent, () => Promise.resolve('allowed-once'))).resolves.toBe(
      'allowed-once',
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session closed'))
  })

  it('leaves a session that already asks alone', async () => {
    const { agent, events, holder } = fixture('ask')
    await new CliAskPolicy(vi.fn()).asking(holder, agent, () => Promise.resolve('allowed-once'))
    expect(events).toEqual([])
  })

  it('leaves the harness default alone when the session overrides nothing', async () => {
    const { agent, events, holder } = fixture(undefined)
    await new CliAskPolicy(vi.fn()).asking(holder, agent, () => Promise.resolve('allowed-once'))
    expect(events).toEqual([])
  })

  it('does nothing on a harness too old to report an override', async () => {
    const { agent, events } = fixture('never')
    await new CliAskPolicy(vi.fn()).asking({}, agent, () => Promise.resolve('allowed-once'))
    expect(events).toEqual([])
  })
})
