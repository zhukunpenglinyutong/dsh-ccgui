/**
 * The contract of a CLI session: what it is built from, what one harness step asks of it,
 * and the events its reader consumes.
 * @module dsh-ccgui/session/types
 */

import type { RequestMessage } from '@deepseek-ai/dsh-llm'
import type { CliEffortList, CliModeList, CliModelList } from '../model-options.ts'
import type { ReadImage } from '../prompt-images.ts'
import type { AcpTransport, TransportHandlers } from '../transport.ts'
import type { PtcWrap } from './ptc-call.ts'
import type { TurnEnd } from './turn-queue.ts'

/** Construction inputs for one CLI session. */
export interface CliSessionOptions {
  readonly dshSessionId: string
  /** The provider route of this CLI, which tells its native sessions from another CLI's. */
  readonly provider: string
  readonly cwd: string
  /** CLI display name used in user-facing messages. */
  readonly label: string
  /** Opens the connection on first use. */
  readonly openTransport: (handlers: TransportHandlers) => AcpTransport
  readonly mintCallId?: () => string
  /** How long a cancelled CLI may take to finish its turn before it is abandoned. */
  readonly cancelGraceMs?: number
  /** How long the CLI may take to accept a session, which must allow for a cold `npx` download. */
  readonly startTimeoutMs?: number
  /** How long a pending command's reports must stay quiet before it counts as started. */
  readonly toolSettleMs?: number
  /** What this CLI reported about its models when asked ahead of any session. */
  readonly knownModels?: () => CliModelList | undefined
  /**
   * A native mode the user picked before this session existed. Sent with the first step,
   * since there is no CLI session to change before then.
   */
  readonly initialMode?: string
  /**
   * Told the reasoning levels of each model the CLI reported, undefined for none. Held until
   * the CLI's turn ends: the harness checks the level on every step against the catalog.
   */
  readonly onEfforts?: (model: string, effort: CliEffortList | undefined) => void
  /**
   * Told the native modes a new CLI session starts with, in the CLI's own ids and names. Kept
   * per provider so switching CLIs never carries one CLI's modes over to another.
   */
  readonly onModes?: (modes: CliModeList) => void
  /** Told when the CLI would not take {@link initialMode}, which the session has then dropped. */
  readonly onModeRefused?: (mode: string) => void
  /** Reads pasted images from the harness; absent when it has no attachment service. */
  readonly readImage?: ReadImage
  /** Receives failures that have no caller left to reject. */
  readonly onError?: (error: unknown) => void
  /** User messages an earlier CLI process for this harness session received. */
  readonly sentMessageIds?: ReadonlySet<string>
  /**
   * Settles once any earlier process for this harness session has stopped, because
   * two CLIs must not work on one native session and working directory at once.
   */
  readonly after?: Promise<void>
}

/** One harness model request. */
export interface StreamRequest {
  readonly messages: readonly RequestMessage[]
  /** Ids of the user messages in the open harness turn; omitted, every message qualifies. */
  readonly currentTurnMessageIds?: ReadonlySet<string>
  /** The model selected in the harness; omitted or `default` means the CLI's own. */
  readonly model?: string
  /** The reasoning level selected in the harness, or its default filled in; omitted leaves the CLI's own. */
  readonly reasoningEffort?: string
  readonly signal?: AbortSignal
  /** Set in a PTC session: this step's tool call goes out wrapped in `run_code`. */
  readonly ptc?: PtcWrap
}

/** What the step reader consumes, in the order it happened. */
export type SessionEvent =
  | {
      readonly type: 'text' | 'reasoning'
      readonly text: string
      /** Written by this plugin, not the CLI, so it never explains why the CLI refused. */
      readonly notice?: true
    }
  | { readonly type: 'tool-ready'; readonly acpId: string }
  | TurnEnd
