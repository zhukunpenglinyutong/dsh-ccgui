/**
 * The ACP operations a CLI session needs, separated from process and SDK details.
 * @module dsh-ccgui/transport
 */

import type {
  ContentBlock,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  Usage,
} from '@agentclientprotocol/sdk'

/** Callbacks from the CLI to its session. */
export interface TransportHandlers {
  /** One `session/update` notification. */
  onUpdate(update: SessionUpdate): void
  /** One `session/request_permission` request; the CLI blocks until this settles. */
  onPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse>
  /** The process or connection ended, expectedly or not. */
  onClosed(error: Error): void
}

/** What a CLI reports when it opens a session. */
export interface SessionInfo {
  readonly sessionId: string
  readonly configOptions?: readonly SessionConfigOption[] | null | undefined
}

/** How a CLI turn ended, as the CLI reported it. */
export interface PromptOutcome {
  readonly stopReason: StopReason
  /** Cumulative token usage for the turn; many CLIs do not report it, and the plugin does not forward it. */
  readonly usage?: Usage | null | undefined
  /**
   * What the CLI attached to its answer. A refusal has no field of its own in ACP, so a
   * CLI that explains itself at all may put the reason here instead of streaming text.
   */
  readonly meta?: Readonly<Record<string, unknown>> | null
  /** The CLI's own stderr tail when the turn ended; some CLIs say nothing anywhere else. */
  readonly stderr?: string
}

/** Client side of one ACP connection. */
export interface AcpTransport {
  initialize(): Promise<InitializeResponse>
  newSession(cwd: string): Promise<SessionInfo>
  resumeSession(sessionId: string, cwd: string): Promise<readonly SessionConfigOption[] | null | undefined>
  loadSession(sessionId: string, cwd: string): Promise<readonly SessionConfigOption[] | null | undefined>
  /** Resolves with the options as the CLI now reports them, so a change can be confirmed. */
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<readonly SessionConfigOption[] | null | undefined>
  deleteSession(sessionId: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
  /** Resolves when the whole CLI turn ends, however many tools it ran. */
  prompt(sessionId: string, blocks: readonly ContentBlock[]): Promise<PromptOutcome>
  cancel(sessionId: string): void
  /** Stops the CLI. `force` skips the wait for it to exit by itself. */
  dispose(force?: boolean): Promise<void>
}
