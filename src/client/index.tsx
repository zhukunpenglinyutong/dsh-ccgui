/// <reference lib="dom" />

/**
 * Browser half: a switcher and a model menu in the composer's tool row. The harness offers
 * slots for compact controls there, and both reuse the model directory, so they stay in
 * step with each other and with the harness's own model menu. A terminal button in the
 * session header (see terminal-entry.tsx) saves the trip through the right sidebar, a startup
 * script control beside it (see launch-script-entry.tsx) runs saved commands there,
 * "添加到对话" in file context menus (see add-to-chat.tsx) mentions a path in the composer, and
 * the right sidebar opens on 工作区文件 rather than the guide (see files-default.ts), and a
 * workspace's context menu offers 新建 Worktree… (see worktree/worktree-register.tsx). A settings
 * page in the left sidebar (see settings-register.ts) orders the switcher's providers and hides
 * some (see cli-prefs.ts), and switches the header buttons and the files default off for users
 * who prefer the harness's original interaction.
 * @module dsh-ccgui/client
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { registerAddToChat } from './add-to-chat.tsx'
import type { AddToChatContext } from './add-to-chat.tsx'
import { cliChoices, selectionForChoice } from './choices.ts'
import { arrangeChoices, createCliPrefs } from './cli-prefs.ts'
import type { CliPrefs, CliPrefsStorage } from './cli-prefs.ts'
import type { DirectorySelection, DirectoryState } from './choices.ts'
import { ProviderMark } from './marks.tsx'
import { CliModeSeat } from './mode-seat.tsx'
import { CliModelMenu } from './model-menu.tsx'
import { MODEL_MENU_STYLES } from './model-menu-styles.ts'
import { modeApiFor } from './mode-api.ts'
import {
  SESSION_STATUS_SLOT,
  SESSION_STATUS_STYLES,
  SessionStatusMark,
  useSessionProvider,
} from './session-status-mark.tsx'
import type { SessionList } from './session-status-mark.tsx'
import { useStore } from './store.ts'
import type { Store } from './store.ts'
import { TERMINAL_ENTRY_STYLES, registerTerminalEntry } from './terminal-entry.tsx'
import { registerFilesDefault } from './files-default.ts'
import { registerChanges } from './changes/changes-register.ts'
import type { ChangesContext } from './changes/changes-register.ts'
import { CHANGES_STYLES } from './changes/changes-styles.ts'
import type { FilesDefaultContext } from './files-default.ts'
import { LAUNCH_SCRIPT_STYLES } from './launch-script-styles.ts'
import { SESSION_TREE_STYLES } from './session-tree-styles.ts'
import { registerLaunchScripts } from './launch-script-register.ts'
import type { LaunchScriptContext } from './launch-script-register.ts'
import type { ScriptStorage } from './launch-scripts.ts'
import type { TerminalEntryContext } from './terminal-entry.tsx'
import { createFeatureSettings, whileEnabled } from './feature-settings.ts'
import { installCompactTabs } from './compact-tabs.ts'
import type { FeatureSettings, FeatureStorage } from './feature-settings.ts'
import { SETTINGS_PAGE_STYLES } from './settings-page.tsx'
import { gateInject, registerSettingsPage } from './settings-register.ts'
import { registerWorktree } from './worktree/worktree-register.tsx'
import type { WorktreeContext } from './worktree/worktree-register.tsx'
import type { ExpansionStorage } from './worktree/worktree-expansion.ts'
import { WORKTREE_GROUP_STYLES } from './worktree/worktree-group-styles.ts'
import { WORKTREE_STYLES } from './worktree/worktree-styles.ts'

interface SwitcherInjected {
  directory: Store<DirectoryState>
  load: () => void
  select: (selection: DirectorySelection) => Promise<{ error?: { message?: string } }>
  session: Store<{ blank?: boolean; removed?: boolean }> | undefined
}

type CliSwitcherProps = SwitcherInjected & { prefs: CliPrefs }

/** The parts of the harness's client context this plugin uses. */
interface ClientContext {
  effect(run: () => () => void, label?: string): void
  inject: TerminalEntryContext['inject'] &
    AddToChatContext['inject'] &
    LaunchScriptContext['inject'] &
    FilesDefaultContext['inject'] &
    ChangesContext['inject'] &
    WorktreeContext['inject']
  slots: {
    inject(name: string, add: () => unknown): void
    register(
      options: { name: string; id: string; order?: number; inject(sessionId: string): unknown },
      component: unknown,
    ): unknown
  }
  modelDirectories: {
    directoryFor(sessionId: string): {
      store: Store<DirectoryState>
      load(): Promise<unknown>
      select(selection: DirectorySelection): Promise<{ error?: { message?: string } }>
    }
  }
  sessions: {
    binding(sessionId: string): { session: Store<{ blank?: boolean; removed?: boolean }> } | undefined
    list: SessionList
    subagentAddress(sessionId: string): unknown
  }
}

const SLOT = 'conversation.input.left'
const MODEL_SLOT = 'conversation.input.right'
/** Beside the CLI switcher: a CLI's mode belongs to that CLI session, read next to its name. */
const MODE_SLOT = 'conversation.input.left'
/** Right after the switcher, which registers with the default order. */
const MODE_SEAT_ORDER = 1
const SESSION_ROW_SLOT = 'sidebar.session.row.leading'
/** Keeps the menu last in its slot, which is where the harness's own seat would be. */
const MODEL_MENU_ORDER = 1000
/** Runs after the harness's own marks, which outrank this one in the row's single cell. */
const SESSION_MARK_ORDER = 20
const WRAP_CLASS = 'dsh-cli-switcher-wrap'
const BUTTON_CLASS = 'dsh-cli-switcher'
const SESSION_MARK_CLASS = 'dsh-cli-session-mark'
const NOT_STARTED = { blank: true }
const NO_CHOICE_LABEL = '选择 CLI'
const SWITCH_FAILED_LABEL = '切换失败'

// The composer slot wraps each entry, hence its `> * >`. A session row has one 16px cell,
// so this mark gives way to whichever occupant the harness put there first.
// The slot renders after the permission control, inside a `display: contents` wrapper,
// so `order` moves this between the + button and that control. If the harness changes
// its markup the button only shifts along the row. Colors and metrics follow the
// neighboring controls.
const STYLES = `
.${WRAP_CLASS} { order: -1; }
:has(> * > .${WRAP_CLASS}) > :first-child { order: -2; }
.${BUTTON_CLASS} {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.${BUTTON_CLASS}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${BUTTON_CLASS}:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, currentColor); }
.${BUTTON_CLASS}:disabled { cursor: default; }
.${SESSION_MARK_CLASS} { display: inline-flex; color: var(--dsw-alias-label-secondary); }
[data-slot="${SESSION_ROW_SLOT}"] > * ~ .${SESSION_MARK_CLASS} { display: none; }
`

// Looked up on each call: touching `localStorage` can throw where storage is blocked, and
// that should cost the startup scripts, not the plugin's start.
const BROWSER_STORAGE: ScriptStorage & FeatureStorage & CliPrefsStorage & ExpansionStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value)
  },
}

function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-ccgui'
  tag.textContent = `${STYLES}${MODEL_MENU_STYLES}${TERMINAL_ENTRY_STYLES}${LAUNCH_SCRIPT_STYLES}${SESSION_TREE_STYLES}${SESSION_STATUS_STYLES}${SETTINGS_PAGE_STYLES}${CHANGES_STYLES}${WORKTREE_STYLES}${WORKTREE_GROUP_STYLES}`
  document.head.append(tag)
  return () => {
    tag.remove()
  }
}

function useStarted(session: Store<{ blank?: boolean }> | undefined): boolean {
  const snapshot = useSyncExternalStore(
    (listener) =>
      session?.subscribe(listener) ??
      (() => {
        /* no session, nothing to unsubscribe */
      }),
    () => session?.getSnapshot() ?? NOT_STARTED,
  )
  return snapshot.blank === false
}

function useChoose(state: DirectoryState, select: SwitcherInjected['select']) {
  const [error, setError] = useState<string | undefined>()
  const choose = (id: string): void => {
    setError(undefined)
    const selection = selectionForChoice(state, id)
    if (selection === undefined) return
    void select(selection).then(
      (result) => {
        setError(result.error?.message)
      },
      (reason: unknown) => {
        setError(String(reason))
      },
    )
  }
  return { error, choose }
}

function CliSwitcher({ directory, load, select, session, prefs }: CliSwitcherProps) {
  const state = useStore(directory)
  const started = useStarted(session)
  const prefsSnapshot = useStore(prefs)
  const [open, setOpen] = useState(false)
  const { error, choose } = useChoose(state, select)
  useEffect(load, [load])

  const { visible, items: listed, currentId, currentLabel } = cliChoices(state)
  // Without a session-free provider list from the harness, this is how the settings page
  // learns what to offer; remembering an unchanged list is a no-op.
  useEffect(() => {
    prefs.remember(listed)
  }, [prefs, listed])
  if (!visible) return null
  // A hidden provider still names the button when a session is already on it.
  const items = arrangeChoices(listed, prefsSnapshot)
  // A CLI does not know a conversation it did not take part in, so switching is
  // for new sessions. The model menu can still change models within this CLI.
  const hint = started ? '要换 CLI，请新建会话' : (error ?? '切换 CLI')
  const label = error === undefined ? (currentLabel ?? NO_CHOICE_LABEL) : SWITCH_FAILED_LABEL
  return (
    <Menu
      open={open && !started}
      className={WRAP_CLASS}
      items={items.map((item) => ({ ...item, icon: <ProviderMark provider={item.id} size={14} /> }))}
      selectedId={currentId}
      onSelect={(id) => {
        setOpen(false)
        choose(id)
      }}
      onClose={() => {
        setOpen(false)
      }}
      side="top"
      portal
      anchor={
        <button
          type="button"
          className={BUTTON_CLASS}
          aria-label="切换 CLI"
          title={hint}
          disabled={started}
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          {currentId === undefined ? null : <ProviderMark provider={currentId} size={14} />}
          {label}
          {started ? null : <IconChevronDownOutlineRegular size={14} />}
        </button>
      }
    />
  )
}

function SessionMark({ sessionId, list }: { readonly sessionId: string; readonly list: SessionList }) {
  const provider = useSessionProvider(list, sessionId)
  if (provider === undefined) return null
  return (
    <span className={SESSION_MARK_CLASS}>
      <ProviderMark provider={provider} size={14} />
    </span>
  )
}

function directoryFace(ctx: ClientContext, sessionId: string): SwitcherInjected {
  const directory = ctx.modelDirectories.directoryFor(sessionId)
  return {
    directory: directory.store,
    load: () => {
      directory.load().catch(() => {
        /* the harness's model menu reports catalog failures */
      })
    },
    select: (selection: DirectorySelection) => directory.select(selection),
    session: ctx.sessions.binding(sessionId)?.session,
  }
}

/**
 * Register the switchable features, each through a context whose `inject` makes its
 * registrations come and go with the feature's switch.
 * @param ctx - the plugin's client context.
 * @param settings - the feature settings.
 */
function registerSwitchableFeatures(ctx: ClientContext, settings: FeatureSettings): void {
  const terminal: TerminalEntryContext = {
    slots: ctx.slots,
    inject: gateInject(ctx, settings, 'terminalEntry', (deps, apply) => ctx.inject(deps, apply)),
  }
  const files: FilesDefaultContext = {
    inject: gateInject(ctx, settings, 'filesDefault', (deps, apply) => ctx.inject(deps, apply)),
  }
  const scripts: LaunchScriptContext = {
    slots: ctx.slots,
    inject: gateInject(ctx, settings, 'launchScripts', (deps, apply) => ctx.inject(deps, apply)),
  }
  registerTerminalEntry(terminal)
  const changes: ChangesContext = {
    inject: gateInject(ctx, settings, 'gitChanges', (deps, apply) => ctx.inject(deps, apply)),
  }
  const worktree: WorktreeContext = {
    inject: gateInject(ctx, settings, 'worktree', (deps, apply) => ctx.inject(deps, apply)),
  }
  registerFilesDefault(files)
  // window.fetch needs its receiver, so it is wrapped rather than passed bare.
  const fetchFn = (input: string, init: RequestInit): Promise<Response> => window.fetch(input, init)
  registerChanges(changes, ctx.sessions.list, fetchFn)
  registerWorktree(worktree, fetchFn, BROWSER_STORAGE)
  registerLaunchScripts(scripts, ctx.sessions.list, BROWSER_STORAGE, () => crypto.randomUUID())
  ctx.effect(() => whileEnabled(settings, 'compactTabs', () => installCompactTabs(document)), 'ccgui: compact tabs')
}

export const inject = ['slots', 'modelDirectories', 'sessions']

/**
 * Put the composer's controls in their seats: the CLI switcher, the model menu that takes
 * the harness's seat on CLI sessions only, and the CLI's modes in the seat that answers
 * "what may run".
 * @param ctx - the plugin's client context.
 * @param cliPrefs - the remembered CLI choice, which the switcher orders itself by.
 */
function registerComposerSlots(ctx: ClientContext, cliPrefs: CliPrefs): void {
  ctx.slots.inject(SLOT, () =>
    ctx.slots.register(
      {
        name: SLOT,
        id: 'dsh-ccgui.switcher',
        inject: (sessionId) => ({ ...directoryFace(ctx, sessionId), prefs: cliPrefs }),
      },
      CliSwitcher,
    ),
  )
  ctx.slots.inject(MODEL_SLOT, () =>
    ctx.slots.register(
      {
        name: MODEL_SLOT,
        id: 'dsh-ccgui.model-menu',
        order: MODEL_MENU_ORDER,
        inject: (sessionId) => ({
          ...directoryFace(ctx, sessionId),
          available: ctx.sessions.subagentAddress(sessionId) === undefined,
        }),
      },
      CliModelMenu,
    ),
  )
  ctx.slots.inject(SESSION_ROW_SLOT, () =>
    ctx.slots.register(
      {
        name: SESSION_ROW_SLOT,
        id: 'dsh-ccgui.session-mark',
        order: SESSION_MARK_ORDER,
        inject: () => ({ list: ctx.sessions.list }),
      },
      SessionMark,
    ),
  )
}

/**
 * Put the CLI's own mode beside the switcher. A harness session renders nothing here: its
 * access control keeps the composer's permission seat, and the styles hide that control
 * only while the CLI's mode control shows.
 * @param ctx - the plugin's client context.
 */
function registerModeSeat(ctx: ClientContext): void {
  ctx.slots.inject(MODE_SLOT, () =>
    ctx.slots.register(
      {
        name: MODE_SLOT,
        id: 'dsh-ccgui.mode-seat',
        order: MODE_SEAT_ORDER,
        inject: (sessionId) => ({
          ...directoryFace(ctx, sessionId),
          // `window.fetch` needs its receiver, so it is wrapped rather than passed bare.
          modes: modeApiFor((input, init) => window.fetch(input, init), sessionId),
        }),
      },
      CliModeSeat,
    ),
  )
}

/**
 * Mark each session row and its header with the CLI it runs on.
 * @param ctx - the plugin's client context.
 */
function registerSessionMarks(ctx: ClientContext): void {
  ctx.slots.inject(SESSION_STATUS_SLOT, () =>
    ctx.slots.register(
      { name: SESSION_STATUS_SLOT, id: 'dsh-ccgui.session-status-mark', inject: () => ({ list: ctx.sessions.list }) },
      SessionStatusMark,
    ),
  )
}

/**
 * Add the switcher and the model menu to the composer, and a terminal button to the header.
 * @param ctx - the plugin's client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'ccgui: styles')
  const cliPrefs = createCliPrefs(BROWSER_STORAGE)
  registerComposerSlots(ctx, cliPrefs)
  registerModeSeat(ctx)
  registerSessionMarks(ctx)
  const settings = createFeatureSettings(BROWSER_STORAGE)
  registerSettingsPage(ctx, settings, cliPrefs)
  registerSwitchableFeatures(ctx, settings)
  registerAddToChat(ctx)
}
