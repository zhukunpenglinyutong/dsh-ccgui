import type { StopReason } from '@agentclientprotocol/sdk'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { errorMessage, toolCallStep, turnDiagnostics, turnEndStep, turnFailure } from '../../src/session/outcomes.ts'
import { ptcCall } from '../../src/session/ptc-call.ts'
import { nativeReplayState } from '../../src/request-input.ts'
import { appendDelta, EMPTY_BLOCKS } from '../../src/stream-blocks.ts'
import { mergeToolUpdate, toCliToolArgs } from '../../src/tool-record.ts'

const LABEL = 'X CLI'
const REPLAY = { replayState: nativeReplayState('acp-1', 'dsh-1') }

function finishOf(stopReason: StopReason, text = '', diagnostics?: string): unknown {
  const end = { stopReason, text, ...(diagnostics === undefined ? {} : { diagnostics }) }
  const { chunks } = turnEndStep(EMPTY_BLOCKS, end, LABEL, REPLAY)
  return chunks.at(-1)
}

describe('errorMessage', () => {
  it('reads an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('42')
  })
})

describe('turnEndStep', () => {
  it.each([
    ['end_turn', { kind: 'stop' }],
    ['max_tokens', { kind: 'max-tokens' }],
    ['cancelled', { kind: 'aborted', failure: { message: 'X CLI 已取消本轮。', code: 'ABORTED' } }],
    [
      'refusal',
      {
        kind: 'error',
        failure: {
          message: 'X CLI 拒绝继续这个请求，但未说明原因（可查看 CLI 日志了解详情）。',
          code: 'CLI_REFUSAL',
        },
      },
    ],
    [
      'max_turn_requests',
      { kind: 'error', failure: { message: 'X CLI 达到了单轮请求次数上限。', code: 'CLI_TURN_LIMIT' } },
    ],
  ] as const)('finishes a %s turn as %o, carrying the replay state', (stopReason, reason) => {
    expect(finishOf(stopReason)).toEqual({ type: 'finish', reason, ...REPLAY })
  })

  it('reports a stop reason it does not know, by name', () => {
    expect(finishOf('something_new' as StopReason)).toEqual({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'X CLI 以未知原因结束：something_new', code: 'CLI_UNKNOWN_STOP' } },
      ...REPLAY,
    })
  })

  it('closes an open block before finishing, and ends the step', () => {
    const open = appendDelta(EMPTY_BLOCKS, 'text', 'hi').state
    const step = turnEndStep(open, { stopReason: 'end_turn', text: '' }, LABEL, {})
    expect(step.done).toBe(true)
    expect(step.chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(step.chunks.length).toBeGreaterThan(1)
  })
})

describe('refusal details', () => {
  // ACP has no error field on PromptResponse: the reason only arrives as streamed
  // text. Without carrying it into the failure the user sees an empty refusal.
  it('explains a refusal with what the CLI said', () => {
    expect(finishOf('refusal', 'Hy4 限时免费模型的额度已用尽，请切换模型。')).toMatchObject({
      reason: {
        kind: 'error',
        failure: {
          code: 'CLI_REFUSAL',
          message: 'X CLI 拒绝继续这个请求：Hy4 限时免费模型的额度已用尽，请切换模型。',
        },
      },
    })
  })

  it('collapses whitespace in the reason', () => {
    expect(finishOf('refusal', '  模型\n不可用  ')).toMatchObject({
      reason: { failure: { message: 'X CLI 拒绝继续这个请求：模型 不可用' } },
    })
  })

  it('keeps the tail of a long answer, where the reason usually is', () => {
    const message = (
      finishOf('refusal', 'a'.repeat(500) + 'QUOTA_EXCEEDED') as {
        reason: { failure: { message: string } }
      }
    ).reason.failure.message
    expect(message).toContain('QUOTA_EXCEEDED')
    expect(message.startsWith('X CLI 拒绝继续这个请求：…')).toBe(true)
    expect(message.length).toBeLessThan(450)
  })

  // Some CLIs refuse without streaming a word: the reason is then on the answer's `_meta`
  // or on stderr, and the user must not be told there was no reason at all.
  it('falls back to what the CLI left behind when it streamed nothing', () => {
    expect(finishOf('refusal', '', 'Hy4 限时免费模型今日额度已用尽')).toMatchObject({
      reason: {
        kind: 'error',
        failure: {
          code: 'CLI_REFUSAL',
          message: 'X CLI 拒绝继续这个请求：Hy4 限时免费模型今日额度已用尽',
        },
      },
    })
  })

  it('still says nothing was given when neither the answer nor the log has a reason', () => {
    expect(finishOf('refusal', '', '   ')).toMatchObject({
      reason: { failure: { message: 'X CLI 拒绝继续这个请求，但未说明原因（可查看 CLI 日志了解详情）。' } },
    })
  })

  it('leaves a normal finish untouched even when the CLI produced text', () => {
    expect(finishOf('end_turn', 'a complete answer')).toMatchObject({ reason: { kind: 'stop' } })
  })
})

describe('turnDiagnostics', () => {
  it('prefers a named field of the answer', () => {
    expect(turnDiagnostics({ error: '额度已用尽' }, 'noise')).toBe('额度已用尽')
    expect(turnDiagnostics({ message: '模型不可用' }, '')).toBe('模型不可用')
    expect(turnDiagnostics({ reason: '被内容策略拒绝' }, '')).toBe('被内容策略拒绝')
  })

  // CodeBuddy refuses a free-model quota with `stopReason: refusal` and no streamed text.
  // Its reason is a stringified JSON-RPC error under `_meta["codebuddy.ai/errorMessage"]`,
  // surrounded by bookkeeping ids that must not end up on screen.
  const CODEBUDDY_QUOTA =
    '当前您在Hy4模型的免费使用量已超出频率限制，可在2026-11-12 12:21:09重置后使用。您可消耗积分继续使用该模型或切换至其他模型。'
  const codebuddyMeta = (details: string) => ({
    'codebuddy.ai/requestId': '01a1ca7f8cf27b6281cea546289f2394',
    'codebuddy.ai/traceId': '1d22272f7805058ce6335d06cdd862a7',
    'codebuddy.ai/finishReason': 'error',
    'codebuddy.ai/errorMessage': JSON.stringify({
      code: -32003,
      message: 'Quota exceeded: Request failed with status code 429',
      data: { statusCode: 429, code: 6004, category: 'quota', details },
    }),
  })

  it('reads CodeBuddy’s stringified request error and drops its bookkeeping ids', () => {
    const detail = turnDiagnostics(codebuddyMeta(CODEBUDDY_QUOTA), '')
    expect(detail).toBe(CODEBUDDY_QUOTA)
    expect(detail).not.toMatch(/requestId|traceId|-32003|statusCode/)
  })

  it('prefers the explaining sentence over an English template', () => {
    expect(turnDiagnostics(codebuddyMeta('额度已用尽，请切换模型'), '')).toBe('额度已用尽，请切换模型')
  })

  it('still reads a plain errorMessage attached by another CLI', () => {
    expect(turnDiagnostics({ errorMessage: '模型不可用' }, '')).toBe('模型不可用')
    expect(turnDiagnostics({ 'codebuddy.ai/error': '内容策略拒绝' }, '')).toBe('内容策略拒绝')
  })

  // A truncated or half-written payload is not a reason. Parsing fails, the malformed text
  // stays off the screen, and stderr still gets its chance to explain.
  it('falls back to the log when an attached error is malformed JSON', () => {
    const truncated = { 'codebuddy.ai/errorMessage': '{"message":"当前模型配额不足"' }
    expect(turnDiagnostics(truncated, '当前模型配额已用完，请稍后再试')).toBe('当前模型配额已用完，请稍后再试')
    expect(turnDiagnostics(truncated, '')).toBe('')
  })

  it('falls through to the log when the answer only carries ids', () => {
    const ids = { 'codebuddy.ai/requestId': 'abc', 'codebuddy.ai/traceId': 'def' }
    expect(turnDiagnostics(ids, 'quota exceeded for hy4-free')).toBe('quota exceeded for hy4-free')
    expect(turnDiagnostics(ids, '')).toBe('')
  })

  // A diagnostic dump is worse than "未说明原因": show the plain failure rather than
  // a wall of _meta JSON, trace headers or JSON log lines.
  it('never shows a structural payload when no named reason is present', () => {
    const dump = {
      traceparent: '00-78d02baf9da0044cd66da266d8900326-6c51ee98c30947fc-01',
      baggage: 'codebuddy.session_id=01a1ca7f-8949-71d1-ba52-df0cdb8298f3',
      'codebuddy.ai/traceparent': '00-78d02baf9da0044cd66da266d8900326',
      'codebuddy.ai/outcome': 'FAILED_MODEL_REQUEST',
    }
    expect(turnDiagnostics(dump, '')).toBe('')
    expect(turnDiagnostics({ code: 'QUOTA_EXCEEDED', retryAfter: 30 }, '')).toBe('')
    expect(turnDiagnostics({ 'codebuddy.ai/errorMessage': '{"traceparent":"00-abc"}' }, '')).toBe('')
    expect(turnDiagnostics(undefined, '{"code":6004,"category":"quota"}\n')).toBe('')
  })

  it('keeps a readable log line next to an unreadable one', () => {
    const log = '{"code":6004,"category":"quota"}\ncodebuddy: quota exceeded for hy4-free\n'
    expect(turnDiagnostics(undefined, log)).toBe('codebuddy: quota exceeded for hy4-free')
  })

  // Loggers commonly open a line with a bracketed level or time. That is a sentence, and
  // often the very one that explains; only JSON arrays are structure.
  it('keeps a log line that opens with a bracketed level or time', () => {
    expect(turnDiagnostics(undefined, '[ERROR] quota exceeded for hy4-free\n')).toBe(
      '[ERROR] quota exceeded for hy4-free',
    )
    expect(turnDiagnostics(undefined, '[2026-11-11T10:00:00Z] quota exceeded\n')).toBe(
      '[2026-11-11T10:00:00Z] quota exceeded',
    )
    expect(turnDiagnostics(undefined, '[{"code":6004}]\n["quota"]\n[]\n')).toBe('')
  })

  it('reads the last lines of the log when the answer carries nothing', () => {
    expect(turnDiagnostics(undefined, 'starting up\nquota exceeded for hy4-free\n')).toBe(
      'starting up quota exceeded for hy4-free',
    )
    expect(turnDiagnostics(null, '   \n  ')).toBe('')
  })

  it('has nothing to say without an answer or a log', () => {
    expect(turnDiagnostics(undefined, undefined)).toBe('')
  })
})

describe('toolCallStep', () => {
  it('hands the call to the harness as the mirror tool and ends the step', () => {
    const record = mergeToolUpdate(undefined, { toolCallId: 'a', title: 'Run', status: 'in_progress' }, () => 'cli-1')
    const step = toolCallStep(EMPTY_BLOCKS, record, REPLAY)

    expect(step.done).toBe(true)
    expect(step.chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' }, ...REPLAY })
    expect(step.chunks).toContainEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'cli-1', name: 'cli_tool', arguments: JSON.stringify(toCliToolArgs(record)) },
    })
  })

  it('hands the call over as run_code in a PTC session', () => {
    const record = mergeToolUpdate(undefined, { toolCallId: 'a', title: 'Run', status: 'in_progress' }, () => 'cli-1')
    const step = toolCallStep(EMPTY_BLOCKS, record, REPLAY, { timeoutMs: 1_000 })

    expect(step.done).toBe(true)
    expect(step.chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' }, ...REPLAY })
    expect(step.chunks).toContainEqual({
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: 'cli-1',
        name: 'run_code',
        arguments: ptcCall(record, { timeoutMs: 1_000 }).arguments,
      },
    })
  })
})

describe('turnFailure', () => {
  it('passes an LlmError through unchanged', () => {
    const error = new LlmError('already readable', 'CLI_START_FAILED')
    expect(turnFailure(error, LABEL)).toBe(error)
  })

  it('wraps any other error with the CLI name, a code and the cause', () => {
    const cause = new Error('pipe closed')
    const wrapped = turnFailure(cause, LABEL)
    expect(wrapped).toBeInstanceOf(LlmError)
    expect(wrapped.message).toBe('X CLI 执行失败：pipe closed')
    expect(wrapped.code).toBe('CLI_PROMPT_FAILED')
    expect(wrapped.cause).toBe(cause)
  })
})
