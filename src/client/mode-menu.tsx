/// <reference lib="dom" />

/**
 * The CLI's own modes, beside the model control. The list is whatever that CLI reported,
 * in its own ids and names; picking one sends that id straight back. Nothing here decides
 * what a mode means, or relates it to the harness's presets: a CLI that reports no modes
 * gets no control at all.
 * @module dsh-ccgui/client/mode-menu
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconWarningOutlineRegular,
  Menu,
  StateDot,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeApi, ModeReply, NativeModes } from './mode-api.ts'
import { CHEVRON_CLASS, LABEL_CLASS, MODE_CLASS, TRIGGER_CLASS } from './model-menu-styles.ts'

const UNKNOWN_ERROR_LABEL = '未知错误'
/** A pick made before the CLI started only takes effect with the next message. */
const PENDING_HINT = '，下一条消息发送时生效'
/** How often to ask again while a pick waits for the CLI to take it. */
export const MODE_POLL_MS = 1500
/** Enough tries to cover a process that starts slowly, and then the control goes quiet. */
export const MODE_POLL_TRIES = 40

/** What the composer hands the control. */
export interface ModeMenuProps {
  /** The CLI route the session is on; undefined for a harness provider. */
  readonly provider: string | undefined
  /** Absent where the harness offers no mode route, which leaves the control out. */
  readonly api: ModeApi | undefined
  readonly locked: boolean
  /** False before the session's first message, when there is no CLI process to change. */
  readonly started: boolean
}

interface Failure {
  /** Gives each failure a toast of its own. */
  readonly seq: number
  readonly text: string
}

interface Reading {
  readonly reply: ModeReply | undefined
  /** Asks again, for a CLI that changed its mode mid-session. */
  readonly refresh: () => void
  /** Takes in what the route answered a pick with. */
  readonly accept: (next: ModeReply) => void
}

const textOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/**
 * Read the modes for this session's CLI, and again whenever asked: a name read once would
 * go stale as soon as the CLI changed its own mode. A pick the CLI has not taken yet only
 * moves once a message runs, and nothing tells this control when that happened, so it keeps
 * asking for a while instead of leaving a stale hint in place.
 * @param api - the mode route, absent when the harness offers none.
 * @param provider - the CLI route the session is on.
 * @param started - whether the session has a CLI process that could take the pick.
 * @returns the last answer, a way to ask again and a way to take in a newer answer.
 */
function useModeReading(api: ModeApi | undefined, provider: string | undefined, started: boolean): Reading {
  const [reply, setReply] = useState<ModeReply | undefined>()
  useEffect(() => {
    if (api === undefined || provider === undefined) {
      setReply(undefined)
      return undefined
    }
    let current = true
    api.read(provider).then(
      (next) => {
        if (current) setReply(next)
      },
      () => {
        if (current) setReply(undefined)
      },
    )
    return () => {
      current = false
    }
  }, [api, provider])
  const refresh = useCallback(() => {
    if (api === undefined || provider === undefined) return
    api.read(provider).then(setReply, () => {
      /* keep the last answer; the menu is still usable */
    })
  }, [api, provider])
  const pending = reply?.pending
  useEffect(() => {
    if (pending === undefined || !started) return undefined
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (tries > MODE_POLL_TRIES) {
        clearInterval(timer)
        return
      }
      refresh()
    }, MODE_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [pending, started, refresh])
  return { reply, refresh, accept: setReply }
}

interface ChooseProps {
  readonly api: ModeApi
  readonly provider: string
  readonly modes: NativeModes
  readonly pending: string | undefined
  readonly close: () => void
  readonly accept: (next: ModeReply) => void
}

/**
 * Send a pick and report a refusal.
 * @param props - the route, the modes it last reported and where to put the answer.
 * @returns the chosen state, the last failure and the pick handler.
 */
function useChooseMode({ api, provider, modes, pending, close, accept }: ChooseProps) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | undefined>()
  const choose = (value: string): void => {
    close()
    if (value === pending || (pending === undefined && value === modes.current)) return
    setBusy(true)
    api.write(provider, value).then(
      (next) => {
        setBusy(false)
        accept(next)
      },
      (reason: unknown) => {
        setBusy(false)
        setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text: textOf(reason) }))
      },
    )
  }
  return {
    busy,
    failure,
    choose,
    clearFailure: () => {
      setFailure(undefined)
    },
  }
}

interface TriggerProps {
  readonly label: string
  readonly title: string
  readonly open: boolean
  readonly busy: boolean
  readonly locked: boolean
  readonly onToggle: () => void
}

function ModeTrigger({ label, title, open, busy, locked, onToggle }: TriggerProps): ReactElement {
  return (
    <button
      type="button"
      className={TRIGGER_CLASS}
      aria-label={`CLI 模式，当前 ${label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      disabled={locked || busy}
      onClick={onToggle}
    >
      <span className={LABEL_CLASS}>{label}</span>
      {busy ? <StateDot state="ongoing" /> : <IconChevronDownOutlineRegular className={CHEVRON_CLASS} size={14} />}
    </button>
  )
}

interface FailureToastProps {
  readonly failure: Failure
  readonly root: HTMLElement | null
  readonly clear: () => void
}

function FailureToast({ failure, root, clear }: FailureToastProps): ReactElement {
  return (
    <Toast
      key={failure.seq}
      text={`切换 CLI 模式失败：${failure.text || UNKNOWN_ERROR_LABEL}`}
      icon={<IconWarningOutlineRegular />}
      anchor={root}
      onDone={clear}
    />
  )
}

interface Headline {
  readonly label: string
  readonly title: string
}

/** What the button says: the pending pick if there is one, else the mode the CLI confirmed. */
function headlineOf(modes: NativeModes, pending: string | undefined): Headline {
  const shown = modes.options.find((option) => option.value === (pending ?? modes.current))
  const label = shown?.name ?? modes.current
  return { label, title: `CLI 模式：${label}${pending === undefined ? '' : PENDING_HINT}` }
}

interface PickerProps {
  readonly modes: NativeModes
  readonly pending: string | undefined
  readonly open: boolean
  readonly busy: boolean
  readonly locked: boolean
  readonly label: string
  readonly title: string
  readonly onSelect: (value: string) => void
  readonly onClose: () => void
  readonly onToggle: () => void
}

function ModePicker(props: PickerProps): ReactElement {
  const { modes, pending, open, onSelect, onClose } = props
  return (
    <Menu
      open={open && !props.locked}
      items={modes.options.map((option) => ({ id: option.value, label: option.name }))}
      selectedId={pending ?? modes.current}
      onSelect={onSelect}
      onClose={onClose}
      side="top"
      portal
      anchor={
        <ModeTrigger
          label={props.label}
          title={props.title}
          open={open}
          busy={props.busy}
          locked={props.locked}
          onToggle={props.onToggle}
        />
      }
    />
  )
}

interface ControlProps {
  readonly api: ModeApi
  readonly provider: string
  readonly reply: ModeReply
  readonly modes: NativeModes
  readonly locked: boolean
  readonly refresh: () => void
  readonly accept: (next: ModeReply) => void
}

/** The button and its menu, for a CLI that does report modes. */
function ModeControl({ api, provider, reply, modes, locked, refresh, accept }: ControlProps): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const { pending } = reply
  const close = (): void => {
    setOpen(false)
  }
  const { busy, failure, choose, clearFailure } = useChooseMode({ api, provider, modes, pending, close, accept })
  const { label, title } = headlineOf(modes, pending)
  return (
    <span ref={rootRef} className={MODE_CLASS}>
      <ModePicker
        modes={modes}
        pending={pending}
        open={open}
        busy={busy}
        locked={locked}
        label={label}
        title={title}
        onSelect={choose}
        onClose={close}
        onToggle={() => {
          const next = !open
          setOpen(next)
          if (next) refresh()
        }}
      />
      {failure !== undefined && (
        <FailureToast
          failure={failure}
          root={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          clear={clearFailure}
        />
      )}
    </span>
  )
}

/**
 * Render the mode button and its menu, or nothing when the CLI reports no modes.
 * @param props - the CLI route, the mode API, whether the session is gone and whether it started.
 * @returns the control.
 */
export function ModeMenu({ provider, api, locked, started }: ModeMenuProps): ReactElement | null {
  const { reply, refresh, accept } = useModeReading(api, provider, started)
  if (api === undefined || provider === undefined || reply?.modes === undefined) return null
  const { modes } = reply
  if (modes.options.length === 0) return null
  return (
    <ModeControl
      api={api}
      provider={provider}
      reply={reply}
      modes={modes}
      locked={locked}
      refresh={refresh}
      accept={accept}
    />
  )
}
