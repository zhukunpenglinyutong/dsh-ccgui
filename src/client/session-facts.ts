/**
 * The two facts the composer's controls need from a session: whether it is gone, and
 * whether it has started. Both come from the harness's own store, and both are read as
 * plain booleans so a re-render only happens when the answer really changes.
 * @module dsh-ccgui/client/session-facts
 */

import { useSyncExternalStore } from 'react'
import type { Store } from './store.ts'

/** What the harness publishes about one session. */
export type SessionFacts = Store<{ blank?: boolean; removed?: boolean }>

const NOTHING = (): void => {
  /* no session, nothing to unsubscribe */
}

function useFact(
  session: SessionFacts | undefined,
  read: (facts: { blank?: boolean; removed?: boolean }) => boolean,
): boolean {
  return useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? NOTHING,
    () => (session === undefined ? false : read(session.getSnapshot())),
  )
}

/**
 * Whether the session has been removed.
 * @param session - its store, when the harness has one.
 * @returns true once it is gone.
 */
export function useRemoved(session: SessionFacts | undefined): boolean {
  return useFact(session, (facts) => facts.removed === true)
}

/**
 * Whether the session has a message yet. Before that its CLI has no process of its own,
 * so a mode picked now can only apply with the first message.
 * @param session - its store, when the harness has one.
 * @returns true once it has started.
 */
export function useStarted(session: SessionFacts | undefined): boolean {
  return useFact(session, (facts) => facts.blank === false)
}
