import { describe, expect, it, vi } from 'vitest'
import type { StopReason } from '@agentclientprotocol/sdk'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { nativeReplayState } from '../src/request-input.ts'
import {
  OPTIONS,
  text,
  thought,
  toolCall,
  toolUpdate,
  user,
  toolResult,
  assistantWithReplay,
  setup,
  collect,
  textOf,
  finishOf,
  toolCallOf,
  gate,
  allow,
  never,
} from './fixtures/cli-session-helpers.ts'

describe('CliSession text turns', () => {
  it('streams text and stops with the native session in replay state', async () => {
    const { fake, session } = setup((t) => {
      t.update(text('hel'))
      t.update(text('lo'))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(textOf(chunks)).toBe('hello')
    expect(finishOf(chunks)).toEqual({
      type: 'finish',
      reason: { kind: 'stop' },
      replayState: nativeReplayState('acp-1', 'dsh-1'),
    })
    expect(fake.prompts).toEqual([[{ type: 'text', text: 'hi' }]])
    expect(fake.newSessions).toEqual(['/repo'])
  })

  it('keeps reasoning separate from text', async () => {
    const { session } = setup((t) => {
      t.update(thought('hm'))
      t.update(text('ok'))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'block-start',
      'reasoning-delta',
      'block-end',
      'block-start',
      'text-delta',
      'block-end',
      'finish',
    ])
  })

  it('ignores updates it has no use for', async () => {
    const { session } = setup((t) => {
      t.update({ sessionUpdate: 'available_commands_update', availableCommands: [] })
      t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x', mimeType: 'image/png' } })
      t.update(text('ok'))
      return 'end_turn' as const
    })
    expect(textOf(await collect(session.stream({ messages: [user('1', 'hi')] })))).toBe('ok')
  })

  it('reuses one CLI session across turns', async () => {
    const { fake, session } = setup(
      () => 'end_turn',
      () => 'end_turn',
    )
    await collect(session.stream({ messages: [user('1', 'one')] }))
    await collect(
      session.stream({ messages: [user('1', 'one'), assistantWithReplay('acp-1', 'dsh-1'), user('2', 'two')] }),
    )
    expect(fake.newSessions).toHaveLength(1)
    expect(fake.prompts).toEqual([[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]])
  })

  it('finishes at once when there is nothing to do', async () => {
    const { fake, session } = setup()
    const chunks = await collect(session.stream({ messages: [user('1', 'x'), toolResult()] }))
    expect(finishOf(chunks)?.reason).toEqual({ kind: 'stop' })
    expect(fake.prompts).toEqual([])
  })

  it.each<[StopReason, string]>([
    ['end_turn', 'stop'],
    ['max_tokens', 'max-tokens'],
    ['cancelled', 'aborted'],
    ['refusal', 'error'],
    ['max_turn_requests', 'error'],
  ])('maps stop reason %s to %s', async (stopReason, kind) => {
    const { session } = setup(() => stopReason)
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(finishOf(chunks)?.reason.kind).toBe(kind)
  })

  // ACP's PromptResponse has no error field: the refusal reason arrives as a
  // streamed text chunk. It must reach the finish failure, or the UI shows a
  // bare "refused" with no way to tell that a free-model quota was exhausted.
  it('puts the CLI refusal reason into the finish failure', async () => {
    const { session } = setup((t) => {
      t.update(text('Hy4 限时免费模型的额度已用尽，请切换模型。'))
      return 'refusal' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    expect(finishOf(chunks)?.reason).toMatchObject({
      kind: 'error',
      failure: {
        code: 'CLI_REFUSAL',
        message: 'OpenCode 拒绝继续这个请求：Hy4 限时免费模型的额度已用尽，请切换模型。',
      },
    })
  })

  // Thinking is the model's working, already on screen in its own block; its last lines are
  // not a reason, and a refusal mid-thought would otherwise quote an unfinished idea.
  it('does not present the model thinking as the refusal reason', async () => {
    const { session } = setup((t) => {
      t.update(thought('the user wants a script, let me start by'))
      return 'refusal' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'hi')] }))
    const reason = finishOf(chunks)?.reason
    expect(reason).toMatchObject({ failure: { message: expect.stringContaining('未说明原因') as unknown } })
    expect(JSON.stringify(reason)).not.toContain('let me start by')
  })
})

describe('CliSession tool calls', () => {
  it('runs one tool across two steps without sending a second prompt', async () => {
    const released = gate()
    const { fake, session } = setup(async (t) => {
      t.update(text('working'))
      t.update(toolCall('a'))
      t.update(toolUpdate('a', { status: 'in_progress', title: 'ls', rawInput: { command: 'ls' } }))
      await released.wait
      t.update(
        toolUpdate('a', {
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
        }),
      )
      t.update(text('done'))
      return 'end_turn' as const
    })
    const messages = [user('1', 'go')]
    const first = await collect(session.stream({ messages }))
    expect(textOf(first)).toBe('working')
    expect(finishOf(first)).toEqual({
      type: 'finish',
      reason: { kind: 'tool-calls' },
      replayState: nativeReplayState('acp-1', 'dsh-1'),
    })
    const call = toolCallOf(first)
    expect(call).toEqual({
      id: 'cli-1',
      name: 'cli_tool',
      args: { title: 'ls', kind: 'execute', command: 'ls', input: { command: 'ls' } },
    })

    released.open()
    await expect(session.waitForTool(call.id, never)).resolves.toEqual({ text: 'a.txt', failed: false, diffs: [] })

    const second = await collect(session.stream({ messages: [...messages, toolResult()] }))
    expect(textOf(second)).toBe('done')
    expect(finishOf(second)?.reason).toEqual({ kind: 'stop' })
    expect(fake.prompts).toHaveLength(1)
  })

  it('publishes a tool that finished before the step read it', async () => {
    const { session } = setup((t) => {
      t.update(toolCall('a', { status: 'completed', rawOutput: { output: 'fast' } }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    await expect(session.waitForTool(toolCallOf(chunks).id, never)).resolves.toMatchObject({ text: 'fast' })
  })

  it('emits one tool per step and keeps the rest for later', async () => {
    const { session } = setup((t) => {
      t.update(toolCall('a', { status: 'completed' }))
      t.update(toolCall('b', { status: 'completed' }))
      return 'end_turn' as const
    })
    const messages = [user('1', 'go')]
    const first = await collect(session.stream({ messages }))
    await session.waitForTool(toolCallOf(first).id, never)
    const second = await collect(session.stream({ messages: [...messages, toolResult()] }))
    expect(toolCallOf(second).id).toBe('cli-2')
    await session.waitForTool('cli-2', never)
    const third = await collect(session.stream({ messages: [...messages, toolResult(), toolResult()] }))
    expect(finishOf(third)?.reason).toEqual({ kind: 'stop' })
  })

  it('fails a published tool the turn left unfinished', async () => {
    const { session } = setup((t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    const outcome = await session.waitForTool(toolCallOf(chunks).id, never)
    expect(outcome.failed).toBe(true)
  })

  it('still publishes a pending tool when the turn ends', async () => {
    const { session } = setup((t) => {
      t.update(toolCall('a'))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    expect(toolCallOf(chunks).id).toBe('cli-1')
    expect((await session.waitForTool('cli-1', never)).failed).toBe(true)
  })

  it('rejects a call it did not issue', async () => {
    const { session } = setup()
    await expect(session.waitForTool('other', never)).rejects.toThrow('other')
  })

  it('ignores a late update for a call already handed to the harness', async () => {
    const done = gate()
    const { session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'completed' }))
      await done.wait
      t.update(toolUpdate('a', { status: 'in_progress' }))
      t.update(text('end'))
      return 'end_turn' as const
    })
    const messages = [user('1', 'go')]
    const first = await collect(session.stream({ messages }))
    await session.waitForTool(toolCallOf(first).id, never)
    done.open()
    const second = await collect(session.stream({ messages: [...messages, toolResult()] }))
    expect(textOf(second)).toBe('end')
    expect(second.some((chunk) => chunk.type === 'tool-call-delta')).toBe(false)
  })

  it('treats a reused id in a new tool_call as a new call', async () => {
    const { session } = setup(
      (t) => {
        t.update(toolCall('a', { status: 'completed' }))
        return 'end_turn' as const
      },
      (t) => {
        t.update(toolCall('a', { status: 'completed' }))
        return 'end_turn' as const
      },
    )
    const first = await collect(session.stream({ messages: [user('1', 'one')] }))
    await session.waitForTool(toolCallOf(first).id, never)
    await collect(session.stream({ messages: [user('1', 'one'), toolResult()] }))
    const second = await collect(session.stream({ messages: [user('1', 'one'), toolResult(), user('2', 'two')] }))
    expect(toolCallOf(second).id).toBe('cli-2')
  })
})

describe('CliSession permissions', () => {
  // The order recorded from OpenCode: in_progress first, permission a moment later.
  it('asks once the tool is published and answers the CLI', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a'))
      t.update(toolUpdate('a', { status: 'in_progress', rawInput: { command: 'rm x' } }))
      const answer = await t.askPermission({
        toolCall: { toolCallId: 'a', status: 'pending', title: 'rm x' },
        options: OPTIONS,
      })
      expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
      t.update(toolUpdate('a', { status: 'completed' }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    const ask = vi.fn(allow)
    const outcome = await session.waitForTool(toolCallOf(chunks).id, ask)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]?.[0]).toEqual({ reason: 'rm x', callId: 'cli-1' })
    expect(outcome.failed).toBe(false)
    expect(fake.permissionAnswers).toHaveLength(1)
  })

  it('publishes a call on the permission request alone', async () => {
    const { session } = setup(async (t) => {
      await t.askPermission({ toolCall: { toolCallId: 'a', title: 'edit' }, options: OPTIONS })
      t.update(toolUpdate('a', { status: 'completed' }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    expect(toolCallOf(chunks).args.title).toBe('edit')
    await session.waitForTool('cli-1', allow)
  })

  it('passes a rejection back so the CLI can report failure', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      t.update(toolUpdate('a', { status: 'failed', rawOutput: 'rejected by user' }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    const outcome = await session.waitForTool(toolCallOf(chunks).id, () => Promise.resolve('rejected'))
    expect(outcome).toMatchObject({ text: 'rejected by user', failed: true })
    expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject' } }])
  })

  it('keeps a diff that only the permission request carried', async () => {
    const diff = { type: 'diff' as const, path: '/repo/h.txt', oldText: null, newText: 'hi' }
    const { session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a', content: [diff] }, options: OPTIONS })
      t.update(
        toolUpdate('a', {
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Created' } }],
        }),
      )
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    const outcome = await session.waitForTool(toolCallOf(chunks).id, allow)
    expect(outcome.diffs).toEqual([{ path: '/repo/h.txt', oldText: null, newText: 'hi' }])
  })
})

describe('CliSession cancellation', () => {
  it('cancels the CLI when a step is aborted and drops its late output', async () => {
    const controller = new AbortController()
    const stopped = gate()
    const { fake, session } = setup(
      async (t) => {
        t.update(text('partial'))
        await stopped.wait
        t.update(text('late'))
        return 'cancelled' as const
      },
      (t) => {
        t.update(text('fresh'))
        return 'end_turn' as const
      },
    )
    const iterator = session.stream({ messages: [user('1', 'go')], signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const pending = iterator.next()
    controller.abort(new Error('user stop'))
    await expect(pending).rejects.toThrow('user stop')
    expect(fake.cancelled).toEqual(['acp-1'])

    const next = collect(session.stream({ messages: [user('1', 'go'), user('2', 'again')] }))
    stopped.open()
    expect(textOf(await next)).toBe('fresh')
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'again' }])
  })

  it('cancels from a tool wait and answers an open permission as cancelled', async () => {
    const controller = new AbortController()
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      return 'cancelled' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    const waiting = session.waitForTool(
      toolCallOf(chunks).id,
      (_request, signal) =>
        new Promise<ApprovalOutcome>((resolve) => {
          signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
        }),
      controller.signal,
    )
    await vi.waitFor(() => expect(fake.prompts).toHaveLength(1))
    controller.abort(new Error('stop'))
    await expect(waiting).rejects.toThrow('stop')
    expect(fake.cancelled).toEqual(['acp-1'])
    await vi.waitFor(() => expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }]))
  })

  it('answers a permission that arrives after cancelling', async () => {
    const controller = new AbortController()
    const sent = gate()
    const { fake, session } = setup(async (t) => {
      t.update(text('x'))
      await sent.wait
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      return 'cancelled' as const
    })
    const iterator = session.stream({ messages: [user('1', 'go')], signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const pending = iterator.next()
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    sent.open()
    await vi.waitFor(() => expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }]))
  })

  it('gives up on a CLI that ignores cancel and marks the session dead', async () => {
    const controller = new AbortController()
    const { fake, session } = setup(async (t) => {
      t.update(text('x'))
      await new Promise(() => {})
      return 'end_turn' as const
    })
    const iterator = session.stream({ messages: [user('1', 'go')], signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const pending = iterator.next()
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    await vi.waitFor(() => expect(session.dead).toBe(true))
    expect(fake.disposed).toBe(true)
    // It already ignored a cancel, so it gets no further chance to keep writing files.
    expect(fake.disposedForcefully).toBe(true)
  })

  it('does not send a new message to a CLI that died during the wait', async () => {
    const controller = new AbortController()
    const { fake, session } = setup(async (t) => {
      t.update(text('x'))
      await new Promise(() => {})
      return 'end_turn' as const
    })
    const iterator = session.stream({ messages: [user('1', 'go')], signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const pending = iterator.next()
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    await expect(collect(session.stream({ messages: [user('1', 'go'), user('2', 'next')] }))).rejects.toThrow(
      '重新发送',
    )
    expect(fake.prompts).toHaveLength(1)
    expect(session.sentMessageIds.has('2')).toBe(false)
  })

  it('does nothing when aborted with no turn running', async () => {
    const { fake, session } = setup()
    const chunks = await collect(session.stream({ messages: [toolResult()] }))
    expect(finishOf(chunks)?.reason).toEqual({ kind: 'stop' })
    expect(fake.cancelled).toEqual([])
  })

  it('rejects at once for an already aborted signal', async () => {
    const { fake, session } = setup()
    const stream = session.stream({ messages: [user('1', 'x')], signal: AbortSignal.abort(new Error('gone')) })
    await expect(collect(stream)).rejects.toThrow('gone')
    expect(fake.prompts).toEqual([])
  })
})

// The harness can stop a turn between steps, when no stream or mirror is there to
// see the abort. Only the end of the harness turn reaches the session then.
describe('CliSession.abandonTurn', () => {
  it('cancels a running CLI turn and drops its output', async () => {
    const stopped = gate()
    const { fake, session } = setup(
      async (t) => {
        t.update(toolCall('a', { status: 'in_progress' }))
        await stopped.wait
        t.update(toolUpdate('a', { status: 'completed' }))
        t.update(text('STALE'))
        return 'cancelled' as const
      },
      (t) => {
        t.update(text('fresh'))
        return 'end_turn' as const
      },
    )
    await collect(session.stream({ messages: [user('1', 'go')] }))
    session.abandonTurn()
    expect(fake.cancelled).toEqual(['acp-1'])
    const next = collect(session.stream({ messages: [user('1', 'go'), user('2', 'new')] }))
    stopped.open()
    const chunks = await next
    expect(textOf(chunks)).toBe('fresh')
    expect(chunks.some((chunk) => chunk.type === 'tool-call-delta')).toBe(false)
  })

  it('drops what a CLI that already finished left unread', async () => {
    const { fake, session } = setup(
      (t) => {
        t.update(toolCall('a', { status: 'completed' }))
        t.update(text('STALE'))
        t.update(toolCall('b', { status: 'completed' }))
        return 'end_turn' as const
      },
      (t) => {
        t.update(text('fresh'))
        return 'end_turn' as const
      },
    )
    await collect(session.stream({ messages: [user('1', 'go')] }))
    session.abandonTurn()
    expect(fake.cancelled).toEqual([])
    const chunks = await collect(session.stream({ messages: [user('1', 'go'), user('2', 'new')] }))
    expect(textOf(chunks)).toBe('fresh')
    expect(chunks.some((chunk) => chunk.type === 'tool-call-delta')).toBe(false)
  })

  it('answers open permissions so the CLI is not left blocked', async () => {
    const { fake, session } = setup(async (t) => {
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      return 'cancelled' as const
    })
    await collect(session.stream({ messages: [user('1', 'go')] }))
    session.abandonTurn()
    await vi.waitFor(() => expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }]))
  })

  it('lets a later turn reuse a tool id from the abandoned one', async () => {
    const { session } = setup(
      (t) => {
        t.update(toolCall('a'))
        return 'cancelled' as const
      },
      (t) => {
        t.update(toolCall('a', { status: 'completed' }))
        return 'end_turn' as const
      },
    )
    const first = session.stream({ messages: [user('1', 'go')] })
    await first.next().catch(() => undefined)
    session.abandonTurn()
    const chunks = await collect(session.stream({ messages: [user('1', 'go'), user('2', 'new')] }))
    expect(toolCallOf(chunks).name).toBe('cli_tool')
  })

  it('is harmless when nothing is running', async () => {
    const { fake, session } = setup(() => 'end_turn' as const)
    await collect(session.stream({ messages: [user('1', 'go')] }))
    session.abandonTurn()
    expect(fake.cancelled).toEqual([])
  })
})

describe('CliSession permissions outside the running mirror', () => {
  // A parent call such as a subtask cannot finish until its child is approved, and
  // the child's mirror cannot start until the parent's returns.
  it('answers another call from the running mirror instead of deadlocking', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('task', { status: 'in_progress', title: 'subtask' }))
      await t.askPermission({
        toolCall: { toolCallId: 'child', title: 'child edit', status: 'pending' },
        options: OPTIONS,
      })
      t.update(toolUpdate('child', { status: 'completed' }))
      t.update(toolUpdate('task', { status: 'completed' }))
      return 'end_turn' as const
    })
    const first = await collect(session.stream({ messages: [user('1', 'go')] }))
    const ask = vi.fn(allow)
    const outcome = await session.waitForTool(toolCallOf(first).id, ask)
    expect(outcome.failed).toBe(false)
    expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'once' } }])
    // The child has no card yet, so the question must not claim to belong to one.
    expect(ask.mock.calls[0]?.[0]).toEqual({ reason: 'child edit' })
  })

  // A policy can deny the mirror before it runs, or a stop can land before dispatch.
  it('rejects the permission of a call whose mirror never ran', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      t.update(text('carried on'))
      return 'end_turn' as const
    })
    const messages = [user('1', 'go')]
    await collect(session.stream({ messages }))
    const next = await collect(session.stream({ messages: [...messages, toolResult()] }))
    expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject' } }])
    expect(textOf(next)).toBe('carried on')
  })

  it('withdraws the question when the CLI exits during approval', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      await new Promise(() => {})
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    let withdrawn = false
    const waiting = session.waitForTool(
      toolCallOf(chunks).id,
      (_request, signal) =>
        new Promise<ApprovalOutcome>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              withdrawn = true
              resolve('cancelled')
            },
            { once: true },
          )
        }),
    )
    await vi.waitFor(() => expect(fake.prompts).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 5))
    fake.close(new Error('exited'))
    expect((await waiting).failed).toBe(true)
    expect(withdrawn).toBe(true)
  })

  it('treats a failing approval service as a rejection', async () => {
    const { fake, session } = setup(async (t) => {
      t.update(toolCall('a', { status: 'in_progress' }))
      await t.askPermission({ toolCall: { toolCallId: 'a' }, options: OPTIONS })
      t.update(toolUpdate('a', { status: 'failed' }))
      return 'end_turn' as const
    })
    const chunks = await collect(session.stream({ messages: [user('1', 'go')] }))
    await session.waitForTool(toolCallOf(chunks).id, () => Promise.reject(new Error('log append failed')))
    expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject' } }])
  })

  it('refuses a permission request that arrives outside a turn', async () => {
    const { fake, session } = setup(() => 'end_turn' as const)
    await collect(session.stream({ messages: [user('1', 'go')] }))
    await fake.askPermission({ toolCall: { toolCallId: 'x' }, options: OPTIONS })
    expect(fake.permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }])
  })
})

describe('CliSession steering', () => {
  // ACP documents no way to add input to a running turn, so steering waits for
  // the turn to end and then runs as the next prompt within the same harness turn.
  it('sends steering as the next prompt after the running turn ends', async () => {
    const released = gate()
    const { fake, session } = setup(
      async (t) => {
        t.update(toolCall('a', { status: 'in_progress' }))
        await released.wait
        t.update(toolUpdate('a', { status: 'completed' }))
        return 'end_turn' as const
      },
      (t) => {
        t.update(text('steered'))
        return 'end_turn' as const
      },
    )
    const messages = [user('1', 'go')]
    const first = await collect(session.stream({ messages }))
    released.open()
    await session.waitForTool(toolCallOf(first).id, never)
    const second = await collect(session.stream({ messages: [...messages, toolResult(), user('2', 'also this')] }))
    expect(textOf(second)).toBe('steered')
    expect(finishOf(second)?.reason).toEqual({ kind: 'stop' })
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'also this' }])
  })

  it('does not resend input after a failed step', async () => {
    const { fake, session } = setup(
      (): StopReason => {
        throw new Error('model overloaded')
      },
      () => 'end_turn',
    )
    await expect(collect(session.stream({ messages: [user('1', 'one')] }))).rejects.toThrow('model overloaded')
    await collect(session.stream({ messages: [user('1', 'one'), user('2', 'two')] }))
    expect(fake.prompts[1]).toEqual([{ type: 'text', text: 'two' }])
  })
})
