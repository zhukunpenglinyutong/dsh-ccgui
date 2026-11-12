/// <reference lib="dom" />

/**
 * The CLI's own mode, in the seat beside the CLI switcher: it belongs to that CLI session,
 * so it reads next to the CLI's name rather than next to the harness's access control. A
 * session the harness runs renders nothing here — its access control keeps the composer's
 * permission seat, and the styles hide that control only while the CLI's mode control shows.
 * @module dsh-ccgui/client/mode-seat
 */

import type { ReactElement } from 'react'
import { isCliRoute } from '../constants.ts'
import type { DirectoryState } from './choices.ts'
import { menuModels } from './menu-models.ts'
import type { ModeApi } from './mode-api.ts'
import { ModeMenu } from './mode-menu.tsx'
import { MODE_SEAT_CLASS } from './model-menu-styles.ts'
import type { SessionFacts } from './session-facts.ts'
import { useRemoved, useStarted } from './session-facts.ts'
import type { Store } from './store.ts'
import { useStore } from './store.ts'

/** What the permission slot hands this seat. */
export interface ModeSeatInjected {
  /** The session's model directory, which names the provider it is on. */
  directory: Store<DirectoryState>
  /** Reads and switches the CLI's own modes; absent where the harness offers no route. */
  modes?: ModeApi
  session: SessionFacts | undefined
}

/**
 * Render the CLI's mode control beside the switcher, or nothing for a harness session.
 * @param props - what the slot injected.
 * @returns the control, or null.
 */
export function CliModeSeat({ directory, modes, session }: ModeSeatInjected): ReactElement | null {
  const state = useStore(directory)
  const locked = useRemoved(session)
  const started = useStarted(session)
  const provider = menuModels(state).current?.provider
  if (!isCliRoute(provider)) return null
  return (
    <span className={MODE_SEAT_CLASS}>
      <ModeMenu provider={provider} api={modes} locked={locked} started={started} />
    </span>
  )
}
