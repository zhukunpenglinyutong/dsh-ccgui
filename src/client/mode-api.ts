/**
 * The browser side of the composer's mode control. It asks the plugin's mode route what a
 * CLI reported and posts back the id the user picked, unchanged: this layer never maps a
 * CLI mode onto anything the harness has of its own.
 * @module dsh-ccgui/client/mode-api
 */

import { MODE_ROUTE_PREFIX } from '../constants.ts'

/** One mode, in the CLI's own id and name. */
interface NativeMode {
  readonly value: string
  readonly name: string
}

/** A CLI's own modes, as it reported them. */
export interface NativeModes {
  /** Option id the CLI wants back when its mode changes. */
  readonly configId: string
  readonly current: string
  readonly options: readonly NativeMode[]
}

/** What the route knew when it answered. */
export interface ModeReply {
  /** undefined when the CLI reports no modes. */
  readonly modes: NativeModes | undefined
  /** A mode picked before the CLI started, not confirmed yet. */
  readonly pending: string | undefined
}

/** Posts JSON to a plugin route; `window.fetch` needs its receiver, so callers wrap it. */
export type PostJson = (input: string, init: RequestInit) => Promise<Response>

/** What the mode control calls. */
export interface ModeApi {
  read(provider: string): Promise<ModeReply>
  write(provider: string, mode: string): Promise<ModeReply>
}

const UNKNOWN_ERROR = '切换 CLI 模式失败'
const BAD_REPLY = '模式接口返回了无法识别的结果'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function modesOf(value: unknown): NativeModes | undefined {
  if (!isObject(value) || !isText(value.configId) || !isText(value.current) || !Array.isArray(value.options)) {
    return undefined
  }
  const options = value.options.flatMap((option: unknown) =>
    isObject(option) && isText(option.value) && isText(option.name) ? [{ value: option.value, name: option.name }] : [],
  )
  return options.length === 0 ? undefined : { configId: value.configId, current: value.current, options }
}

/**
 * Read a route answer. The route is the plugin's own, but a stale build or an interrupted
 * response must not put a half-read list in front of the user.
 */
function replyOf(body: unknown): ModeReply {
  if (!isObject(body)) throw new Error(BAD_REPLY)
  if (body.success !== true) throw new Error(isText(body.error) ? body.error : UNKNOWN_ERROR)
  const data = isObject(body.data) ? body.data : {}
  return { modes: modesOf(data.modes), pending: isText(data.pending) ? data.pending : undefined }
}

/**
 * @param post - the fetch to post with.
 * @param sessionId - the harness session whose CLI this control speaks to.
 * @returns the mode control's two calls.
 */
export function createModeApi(post: PostJson, sessionId: string): ModeApi {
  const send = async (provider: string, mode?: string): Promise<ModeReply> => {
    const response = await post(MODE_ROUTE_PREFIX, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, provider, ...(mode === undefined ? {} : { mode }) }),
    })
    if (!response.ok) throw new Error(`${UNKNOWN_ERROR}（HTTP ${response.status}）`)
    return replyOf(await response.json())
  }
  return { read: (provider) => send(provider), write: (provider, mode) => send(provider, mode) }
}

/** One API per session: a control that reads in an effect must not be handed a new object
 * on every render, or that effect would read again each time round. */
const perSession = new Map<string, ModeApi>()

/**
 * @param post - the fetch to post with.
 * @param sessionId - the harness session whose CLI this control speaks to.
 * @returns the API for that session, the same object on every call.
 */
export function modeApiFor(post: PostJson, sessionId: string): ModeApi {
  const known = perSession.get(sessionId)
  if (known !== undefined) return known
  const created = createModeApi(post, sessionId)
  perSession.set(sessionId, created)
  return created
}
