/**
 * What the composer's CLI switcher and model menu offer, derived from the model directory.
 * @module dsh-ccgui/client/choices
 */

import { CLI_ROUTE_PREFIX, DEFAULT_MODEL_ID } from '../constants.ts'

/** The provider that stands for the harness in the switcher when the catalog has it. */
const OFFICIAL_PROVIDER_ID = 'deepseek-official'
/** The switcher's one entry for everything the harness runs itself. */
const HARNESS_LABEL = 'DeepSeek'

/** The reasoning levels a model offers, as the harness's catalog advertises them. */
export interface DirectoryReasoning {
  readonly efforts: readonly { readonly id: string; readonly name: string }[]
  /** Absent when the provider picks the level itself. */
  readonly defaultEffort?: string
}

/** One model in the model directory. */
interface DirectoryModel {
  readonly id: string
  readonly name: string
  /** Extra detail the menu shows beside the name, e.g. a CLI's cost multiplier. */
  readonly description?: string
  readonly reasoning?: DirectoryReasoning
}

/** One provider group in the model directory. */
export interface DirectoryGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly DirectoryModel[]
}

/** A session's model selection. */
export interface DirectorySelection {
  readonly provider: string
  readonly model: string
  /** Absent for the model's own default level. */
  readonly reasoningEffort?: string
}

/** The fields of the model directory this switcher reads. */
export interface DirectoryState {
  readonly groups: readonly DirectoryGroup[]
  readonly current: DirectorySelection | null
  /** The selection on its way to the harness, if any. */
  readonly pending?: DirectorySelection | null
  /** The harness's catalog state; `loading` until the first catalog arrives. */
  readonly status?: string
}

/** What the switcher renders. */
export interface CliChoices {
  /** False when no CLI is available, where the button would only repeat the model menu. */
  readonly visible: boolean
  readonly items: readonly { readonly id: string; readonly label: string }[]
  readonly currentId: string | undefined
  readonly currentLabel: string | undefined
}

/** What the model menu renders for a session on a CLI. */
export interface CliModels {
  readonly provider: string
  readonly name: string
  readonly rows: readonly DirectoryModel[]
  readonly currentId: string | undefined
  readonly currentName: string | undefined
  /** False while the only row is the stand-in a CLI has before it reports its models. */
  readonly listed: boolean
}

/**
 * List the models of the CLI a session is on.
 * @param state - the session's model directory.
 * @returns that CLI's rows, or undefined when the session is not on a CLI in the catalog.
 */
export function cliModels({ groups, current }: DirectoryState): CliModels | undefined {
  const group = groups.find((candidate) => candidate.id === current?.provider)
  if (!group?.id.startsWith(CLI_ROUTE_PREFIX)) return undefined
  const selected = group.models.find((model) => model.id === current?.model)
  return {
    provider: group.id,
    name: group.name,
    rows: group.models,
    currentId: selected?.id,
    currentName: selected?.name,
    listed: group.models.some((model) => model.name !== group.name),
  }
}

const isCli = (id: string): boolean => id.startsWith(CLI_ROUTE_PREFIX)

/**
 * Pick the group that stands for the harness. The official route is built in, but a
 * deployment can lack it, so any other provider the harness runs can take its place.
 */
function harnessGroup(groups: readonly DirectoryGroup[]): DirectoryGroup | undefined {
  return groups.find((group) => group.id === OFFICIAL_PROVIDER_ID) ?? groups.find((group) => !isCli(group.id))
}

/**
 * List the providers to switch between: every CLI, plus the harness as a single entry. The
 * model menu already lists each provider the harness runs, including those a user adds in
 * the harness's model settings, so listing them here too would only repeat it.
 * @param state - the session's model directory.
 * @returns the menu's rows and the current choice.
 */
export function cliChoices({ groups, current }: DirectoryState): CliChoices {
  const harness = harnessGroup(groups)
  const harnessItem = harness === undefined ? undefined : { id: harness.id, label: HARNESS_LABEL }
  // The harness entry takes the place of the first harness provider in the directory.
  const firstHarness = groups.findIndex((group) => !isCli(group.id))
  const items = groups.flatMap((group, index) => {
    if (isCli(group.id)) return [{ id: group.id, label: group.name }]
    return index === firstHarness && harnessItem !== undefined ? [harnessItem] : []
  })
  const selected = groups.find((group) => group.id === current?.provider)
  const shown =
    selected === undefined || isCli(selected.id) ? selected && { id: selected.id, label: selected.name } : harnessItem
  return {
    visible: groups.some((group) => isCli(group.id)),
    items,
    currentId: shown?.id,
    currentLabel: shown?.label,
  }
}

/**
 * Pick the model a provider starts on. A CLI starts on its own default; any other
 * provider has no such entry, so it starts on the first model it lists.
 * @param state - the session's model directory.
 * @param provider - the chosen provider.
 * @returns the selection to apply, or undefined when there is nothing to change.
 */
export function selectionForChoice(
  { groups, current }: DirectoryState,
  provider: string,
): DirectorySelection | undefined {
  if (current?.provider === provider) return undefined
  // The switcher's harness entry stands for every harness provider; on one already, the
  // model menu is where to pick another.
  const onHarness = groups.some((group) => group.id === current?.provider && !isCli(group.id))
  if (onHarness && !isCli(provider)) return undefined
  const first = groups.find((group) => group.id === provider)?.models[0]
  if (first === undefined) return undefined
  return { provider, model: provider.startsWith(CLI_ROUTE_PREFIX) ? DEFAULT_MODEL_ID : first.id }
}
