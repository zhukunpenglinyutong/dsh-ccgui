/**
 * DSH's access mode is the harness's stance on sessions it runs itself. A CLI session decides
 * for itself whether to ask, and the question it asks has to reach a person: under the "never
 * ask" stance the approval service answers it with a rejection without asking anyone, which
 * turns the CLI's own `Always Ask` into a silent failure. The stance is the user's setting for
 * the session, so it is only lifted while a CLI question is open, then put back.
 * @module dsh-ccgui/session/approval-policy
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

type Session = Agent['session']

/** The part of the harness's approval service this needs. */
export interface PolicyHolder {
  /** The policy this agent's session carries right now, if it overrides the default. */
  overrideOf?(session: Session): ApprovalPolicy | undefined
}

/** Lifts a session's "never ask" stance for the CLI questions in flight, and restores it. */
export class CliAskPolicy {
  /** Questions in flight per session whose stance this lifted. */
  private open: ReadonlyMap<Session, number> = new Map()

  /** @param warn - reports a stance that could not be put back. */
  constructor(private readonly warn: (message: string) => void) {}

  /**
   * Run one CLI question with the session on "ask". Nothing changes unless a "never ask"
   * override is in force (the access mode's 完全权限); an older harness that cannot report
   * one keeps its default. Questions that overlap share one lift, and the last to settle
   * restores the stance. Both switches are session events, the harness's own record of a
   * policy change, so the log shows them.
   * @param approval - the harness's approval service.
   * @param agent - the agent the CLI asks on behalf of.
   * @param ask - sends the question to the approval service.
   * @returns the answer to the question.
   */
  async asking<T>(approval: PolicyHolder, agent: Agent, ask: () => Promise<T>): Promise<T> {
    const { session } = agent
    if (!this.lift(approval, session)) return ask()
    try {
      return await ask()
    } finally {
      this.release(approval, session)
    }
  }

  /** @returns whether this question runs under a lift that must be released. */
  private lift(approval: PolicyHolder, session: Session): boolean {
    const held = this.open.get(session)
    if (held === undefined) {
      if (approval.overrideOf?.(session) !== 'never') return false
      setApprovalPolicy(session, 'ask')
    }
    this.open = new Map([...this.open, [session, (held ?? 0) + 1]])
    return true
  }

  private release(approval: PolicyHolder, session: Session): void {
    const left = (this.open.get(session) ?? 1) - 1
    this.open =
      left > 0 ? new Map([...this.open, [session, left]]) : new Map([...this.open].filter(([key]) => key !== session))
    // Only this lift is undone. A stance set to "never" meanwhile already holds; an "ask"
    // set meanwhile cannot be told apart from the lift, and is undone with it.
    if (left > 0 || approval.overrideOf?.(session) !== 'ask') return
    try {
      setApprovalPolicy(session, 'never')
    } catch (error: unknown) {
      // The answer is already decided; a stance that cannot be written back must not undo it.
      this.warn(
        `ccgui: could not restore the never-ask stance: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
