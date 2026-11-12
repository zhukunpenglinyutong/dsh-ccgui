/**
 * How a CLI turn's ending reads to the harness, and the chunks that close a harness step.
 * @module dsh-ccgui/session/outcomes
 */

import type { StopReason } from '@agentclientprotocol/sdk'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CLI_TOOL_NAME } from '../constants.ts'
import { closeOpenBlock, toolCallChunks } from '../stream-blocks.ts'
import type { BlockState, BlockTransition } from '../stream-blocks.ts'
import { toCliToolArgs } from '../tool-record.ts'
import type { ToolRecord } from '../tool-record.ts'
import { ptcCall } from './ptc-call.ts'
import type { PtcWrap, StreamToolCall } from './ptc-call.ts'

/** Extra fields every `finish` chunk carries so the harness can resume the native session. */
export type ReplayFields = Partial<Pick<Extract<StreamChunk, { type: 'finish' }>, 'replayState'>>

/** One step of reading, and whether it ends the harness step. */
export interface StepResult extends BlockTransition {
  readonly done: boolean
}

/** Why a CLI turn ended, plus what it said before ending. */
export interface TurnOutcome {
  readonly stopReason: StopReason
  /**
   * Text the CLI emitted in this step. ACP's `PromptResponse` has no error field,
   * so a refusal's real reason only arrives as `session/update` content.
   */
  readonly text: string
  /** What the CLI attached to its answer, or left on stderr, when it streamed nothing. */
  readonly diagnostics?: string
}

/** Long refusals would bury the reason in a whole answer; keep its tail. */
const REFUSAL_DETAIL_LIMIT = 400

/** @returns the error's message, or its string form for anything thrown that is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failureFinish(message: string, code: string): FinishReason {
  return { kind: 'error', failure: { message, code } }
}

/** Where a CLI may put its reason on `PromptResponse._meta`, most specific first. */
const META_REASON_KEYS = [
  'codebuddy.ai/errorMessage',
  'errorMessage',
  'codebuddy.ai/error',
  'error',
  'message',
  'reason',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Flatten whitespace without dropping the beginning of a short error. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Unlike a streamed answer, an error explains itself at the start, so keep its head. */
function diagnosticLine(text: string): string {
  const clean = oneLine(text)
  return clean.length <= REFUSAL_DETAIL_LIMIT ? clean : `${clean.slice(0, REFUSAL_DETAIL_LIMIT)}…`
}

/** Every sentence a stringified JSON-RPC error may carry; a CLI often has more than one. */
function errorResponseReasons(parsed: Record<string, unknown>): string[] {
  const data = isRecord(parsed.data) ? parsed.data : {}
  const error = isRecord(parsed.error) ? parsed.error : {}
  return [parsed.message, data.details, data.message, data.reason, error.message].filter(
    (field): field is string => typeof field === 'string' && field.trim() !== '',
  )
}

/** Prefer the sentence that explains over an English template such as "Request failed: 429". */
function bestReason(candidates: string[]): string {
  const chinese = candidates.filter((line) => /[\u4e00-\u9fff]/.test(line))
  const pool = chinese.length > 0 ? chinese : candidates
  return pool.reduce((best, line) => (line.length > best.length ? line : best), '')
}

/** CodeBuddy stringifies its request error into `_meta`; other CLIs attach a plain sentence. */
function unpackReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  const clean = value.trim()
  if (!clean.startsWith('{')) return oneLine(clean)
  try {
    const parsed: unknown = JSON.parse(clean)
    if (!isRecord(parsed)) return oneLine(clean)
    const reasons = errorResponseReasons(parsed)
    return reasons.length === 0 ? oneLine(clean) : oneLine(bestReason(reasons))
  } catch {
    return oneLine(clean)
  }
}

/**
 * A reason is only worth showing if it reads like a sentence. A diagnostic dump —
 * the `_meta` object itself, a trace header, a JSON log line — is worse than the
 * plain "未说明原因" failure, so it must never reach the user. A line that opens with a
 * bracketed level or time (`[ERROR] …`) is a sentence; only a JSON array is structure.
 */
function isReadableReason(text: string): boolean {
  const clean = text.trim()
  if (clean === '') return false
  return (
    !/^(?:\{|\[\s*[{["\]])/.test(clean) &&
    !/"(?:code|statusCode|category|traceparent|baggage|outcome|codebuddy\.ai\/[\w-]+)"\s*:/.test(clean)
  )
}

/** A CLI's own words for why it stopped, when it attached them instead of streaming text. */
function attachedReason(meta: Readonly<Record<string, unknown>> | null | undefined): string {
  if (meta == null) return ''
  for (const key of META_REASON_KEYS) {
    const reason = unpackReason(meta[key])
    if (isReadableReason(reason)) return diagnosticLine(reason)
  }
  return ''
}

/** The last few lines a CLI wrote to stderr, which is the only place some of them explain. */
function logTail(stderr: string | undefined): string {
  const lines = (stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => isReadableReason(line))
  return lines.length === 0 ? '' : diagnosticLine(lines.slice(-2).join(' '))
}

/**
 * What the CLI left behind when it ended without saying why in the stream.
 * @param meta - the response's `_meta`, when the CLI attached one.
 * @param stderr - the CLI's stderr tail at the moment the turn ended.
 * @returns a one-line reason, or '' when there is nothing to show.
 */
export function turnDiagnostics(
  meta: Readonly<Record<string, unknown>> | null | undefined,
  stderr: string | undefined,
): string {
  const attached = attachedReason(meta)
  const behind = attached === '' ? logTail(stderr) : attached
  // Last gate: no path may put a diagnostic dump on screen.
  return isReadableReason(behind) ? behind : ''
}

/** Collapse a CLI explanation into one line, keeping its tail if it is long. */
function refusalDetail(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= REFUSAL_DETAIL_LIMIT) return clean
  return `…${clean.slice(clean.length - REFUSAL_DETAIL_LIMIT)}`
}

/**
 * Map an ACP stop reason onto the harness's finish reason. A refusal has no
 * structured reason in ACP, so the text the CLI already streamed is the only
 * place the user can learn why the model was refused.
 * @param end - why the CLI ended its turn and what it said.
 * @param label - CLI display name used in user-facing messages.
 * @returns the finish reason the harness should record.
 */
function finishReason(end: TurnOutcome, label: string): FinishReason {
  switch (end.stopReason) {
    case 'end_turn':
      return { kind: 'stop' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    case 'cancelled':
      return { kind: 'aborted', failure: { message: `${label} 已取消本轮。`, code: 'ABORTED' } }
    case 'refusal': {
      const detail = refusalDetail(end.text)
      if (detail !== '') return failureFinish(`${label} 拒绝继续这个请求：${detail}`, 'CLI_REFUSAL')
      const behind = end.diagnostics?.trim() ?? ''
      const message =
        behind === ''
          ? `${label} 拒绝继续这个请求，但未说明原因（可查看 CLI 日志了解详情）。`
          : `${label} 拒绝继续这个请求：${behind}`
      return failureFinish(message, 'CLI_REFUSAL')
    }
    case 'max_turn_requests':
      return failureFinish(`${label} 达到了单轮请求次数上限。`, 'CLI_TURN_LIMIT')
    default:
      return failureFinish(`${label} 以未知原因结束：${String(end.stopReason)}`, 'CLI_UNKNOWN_STOP')
  }
}

function mirroredCall(record: ToolRecord): StreamToolCall {
  return { id: record.callId, name: CLI_TOOL_NAME, arguments: JSON.stringify(toCliToolArgs(record)) }
}

/**
 * End a harness step at a tool call the harness should run as the mirror tool.
 * @param ptc - set in a PTC session, where the call goes out wrapped in `run_code`.
 * @returns the tool-call chunks followed by a `tool-calls` finish.
 */
export function toolCallStep(blocks: BlockState, record: ToolRecord, replay: ReplayFields, ptc?: PtcWrap): StepResult {
  const call = ptc === undefined ? mirroredCall(record) : ptcCall(record, ptc)
  const { state, chunks } = toolCallChunks(blocks, call)
  return { state, chunks: [...chunks, { type: 'finish', reason: { kind: 'tool-calls' }, ...replay }], done: true }
}

/**
 * End a harness step at the end of the CLI turn.
 * @returns the closing chunks followed by the turn's finish.
 */
export function turnEndStep(blocks: BlockState, end: TurnOutcome, label: string, replay: ReplayFields): StepResult {
  const { state, chunks } = closeOpenBlock(blocks)
  return {
    state,
    chunks: [...chunks, { type: 'finish', reason: finishReason(end, label), ...replay }],
    done: true,
  }
}

/** @returns the turn's failure as the error the harness reports. */
export function turnFailure(error: Error, label: string): LlmError {
  return error instanceof LlmError
    ? error
    : new LlmError(`${label} 执行失败：${error.message}`, 'CLI_PROMPT_FAILED', { cause: error })
}
