/**
 * The composer's mode route, under `/dsh-ccgui/modes`. A CLI's modes belong to the CLI:
 * the route only lists what that CLI reported and sends the chosen id back unchanged, so
 * no CLI mode is ever turned into a harness preset. Like the git routes, the harness's web
 * server leaves authentication to each route, so every request first asks `connection` for
 * a rejection.
 * @module dsh-ccgui/mode-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { MODE_ROUTE_PREFIX } from './constants.ts'
import type { CliModeList } from './model-options.ts'

/** The parts of the harness's `webServer` service this module uses. */
export interface ModeWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}

/** The parts of the harness's `connection` service this module uses. */
export interface ModeConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** What the route reads from the bridge. */
export interface ModeRoutes {
  /** The modes known for a session's route, and a pick the CLI has not confirmed. */
  modeState(sessionId: string, provider: string): { readonly modes?: CliModeList; readonly pending?: string }
  /** Ask that CLI to switch, by the id it reported. */
  switchMode(sessionId: string, provider: string, mode: string): Promise<CliModeList | undefined>
}

/** A body is two ids and an optional mode; anything larger is not a request this route takes. */
const MAX_BODY_BYTES = 8 * 1024

class BodyTooLarge extends Error {
  override name = 'BodyTooLarge'
}

interface RequestFields {
  readonly sessionId: string
  readonly provider: string
  /** Absent when the caller only reads. */
  readonly mode: string | undefined
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(payload))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge('请求内容过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Read the one body shape this route accepts. */
function fieldsOf(body: unknown): RequestFields | undefined {
  if (!isObject(body) || !isText(body.sessionId) || !isText(body.provider)) return undefined
  if (body.mode !== undefined && !isText(body.mode)) return undefined
  return { sessionId: body.sessionId, provider: body.provider, mode: body.mode }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the handler for the mode route.
 * @param routes - what the bridge knows about native modes.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns the request handler.
 */
export function modeHandler(
  routes: ModeRoutes,
  connection: ModeConnection,
  warn: (message: string) => void,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      sendJson(res, rejection, { success: false, error: '未授权' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: '只支持 POST' }, { allow: 'POST' })
      return
    }
    let fields: RequestFields | undefined
    try {
      fields = fieldsOf(await readJson(req))
    } catch (error: unknown) {
      const tooLarge = error instanceof BodyTooLarge
      sendJson(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? '请求内容过大' : '请求格式不正确' })
      return
    }
    if (fields === undefined) {
      sendJson(res, 400, { success: false, error: '请求缺少会话或 CLI' })
      return
    }
    try {
      // Sending a mode and reading the state are one operation: the answer is what that
      // CLI reports after the change, in the same ids and names it gave.
      if (fields.mode !== undefined) await routes.switchMode(fields.sessionId, fields.provider, fields.mode)
      const { modes, pending } = routes.modeState(fields.sessionId, fields.provider)
      sendJson(res, 200, { success: true, data: { modes: modes ?? null, pending: pending ?? null } })
    } catch (error: unknown) {
      const known = error instanceof LlmError
      if (!known) warn(`ccgui: mode request failed: ${messageOf(error)}`)
      sendJson(res, known ? 400 : 500, { success: false, error: known ? messageOf(error) : '切换模式失败，请查看日志' })
    }
  }
}

/**
 * Serve the mode route on the harness's web server.
 * @param server - the harness's web server.
 * @param routes - what the bridge knows about native modes.
 * @param connection - the harness's trust check.
 * @param warn - logs failures that are not the user's doing.
 * @returns a disposer that unregisters the route.
 */
export function registerModeRoute(
  server: ModeWebServer,
  routes: ModeRoutes,
  connection: ModeConnection,
  warn: (message: string) => void,
): () => void {
  return server.register({ kind: 'prefix', path: MODE_ROUTE_PREFIX, handler: modeHandler(routes, connection, warn) })
}
