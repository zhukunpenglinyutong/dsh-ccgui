/**
 * Reads a CLI's model list, its reasoning levels, and the native modes it reports, out of
 * the configuration options ACP sends. Every option id and name stays exactly as the CLI
 * gave it; nothing here maps a CLI concept onto a harness one.
 * @module dsh-ccgui/model-options
 */

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { compactDescription, DEFAULT_MODEL_ID } from './constants.ts'

/** One model a CLI offers. */
export interface CliModelOption {
  readonly value: string
  readonly name: string
  /** What the CLI says about the model, typically its usage cost multiplier. */
  readonly description?: string
}

/** The reasoning levels a model offers and which one is set. */
export interface CliEffortList {
  /** Option id to send when changing the level; each CLI names it differently. */
  readonly configId: string
  readonly current: string
  readonly options: readonly CliModelOption[]
}

/**
 * A CLI's own modes, exactly as it reports them. The set belongs to the CLI, not to the
 * harness: each route keeps its own list and its own current value.
 */
export interface CliModeList {
  /** Option id to send when changing the mode; ACP does not fix this name. */
  readonly configId: string
  readonly current: string
  readonly options: readonly CliModelOption[]
}

/** The models a CLI offers and which one is active. */
export interface CliModelList {
  /** Option id to send when switching; ACP does not fix this name. */
  readonly configId: string
  readonly current: string
  readonly options: readonly CliModelOption[]
  /** The CLI's native modes, in the CLI's own ids and names. Absent when it reports none. */
  readonly modes?: CliModeList
  /**
   * Reasoning levels by model id, for the models seen so far: `null` for a model seen to
   * offer none. Absent when no model has been seen with levels.
   */
  readonly efforts?: Readonly<Record<string, CliEffortList | null>>
}

/** An entry as read, before names it shares with others are told apart. */
interface ReadEntry extends CliModelOption {
  readonly description: string | undefined
}

const CONVENTIONAL_MODEL_OPTION_ID = 'model'
const MODEL_CATEGORY = 'model'
const MODE_CATEGORY = 'mode'
const EFFORT_CATEGORY = 'thought_level'
/** Joins a model name and the detail that distinguishes it. */
const NAME_SEPARATOR = ' · '

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function flattenEntries(entries: unknown): readonly unknown[] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry: unknown) => {
    if (!isObject(entry) || !('options' in entry)) return [entry]
    return Array.isArray(entry.options) ? (entry.options as unknown[]) : []
  })
}

/**
 * A CLI's own default entry can be named for its role, "Default (recommended)", with only the
 * description saying which model that is. The menu names the model, as it does for other CLIs.
 */
function readEntry(entry: unknown): readonly ReadEntry[] {
  if (!isObject(entry) || !isText(entry.value)) return []
  const name = entry.value === DEFAULT_MODEL_ID && isText(entry.description) ? entry.description : entry.name
  const description = isText(entry.description) ? entry.description : undefined
  return [{ value: entry.value, name: isText(name) ? name : entry.value, description }]
}

/**
 * A CLI can list several models under one name, CodeBuddy's free and paid tiers of Hy4
 * among them, which would leave rows nobody can tell apart. Names stay exactly as the CLI
 * gave them: the menu shows each compact usage-cost label beside its name, and differing
 * labels are what tell those rows apart. Only when labels cannot do that, including when the
 * descriptions are prose the menu leaves out, do the ids join the name. The default entry's
 * description already names the model it stands for, so it is not repeated beside the name.
 */
function distinguishNames(entries: readonly ReadEntry[]): readonly CliModelOption[] {
  const named = entries.filter(({ value }) => value !== DEFAULT_MODEL_ID)
  const peersOf = (name: string): readonly ReadEntry[] => named.filter((entry) => entry.name === name)
  return entries.map(({ value, name, description }) => {
    const withDescription = description === undefined ? { value, name } : { value, name, description }
    if (value === DEFAULT_MODEL_ID) return { value, name }
    const peers = peersOf(name)
    if (peers.length < 2) return withDescription
    // Judged by what the menu actually shows beside a name: prose is left out there.
    const labels = new Set(peers.map((peer) => compactDescription(peer.description)))
    if (labels.size === peers.length && !labels.has(undefined)) return withDescription
    return { ...withDescription, name: `${name}${NAME_SEPARATOR}${value}` }
  })
}

type ConfigOptions = readonly SessionConfigOption[] | null | undefined

function selectsOf(configOptions: ConfigOptions): readonly Record<string, unknown>[] {
  return (Array.isArray(configOptions) ? (configOptions as readonly unknown[]) : [])
    .filter(isObject)
    .filter((candidate) => candidate.type === 'select')
}

/** A level is shown under its own name; the default-model naming does not apply to it. */
function readLevel(entry: unknown): readonly CliModelOption[] {
  if (!isObject(entry) || !isText(entry.value)) return []
  return [{ value: entry.value, name: isText(entry.name) ? entry.name : entry.value }]
}

/** The harness rejects repeated level ids, so only the first of each is kept. */
function uniqueOptions(options: readonly CliModelOption[]): readonly CliModelOption[] {
  return options.filter(({ value }, index) => options.findIndex((option) => option.value === value) === index)
}

/**
 * Find the reasoning level option. Only ACP's category identifies it: the ids differ
 * between CLIs (`effort`, `thinking`, `reasoning_effort`), and an id alone could be
 * some other setting. Checked like the model option, as the SDK does not validate it.
 * @param configOptions - the options a CLI reported, if any.
 * @returns the levels, or undefined when the active model offers none.
 */
export function readEffortList(configOptions: ConfigOptions): CliEffortList | undefined {
  const option = selectsOf(configOptions).find((candidate) => candidate.category === EFFORT_CATEGORY)
  if (option === undefined || !isText(option.id) || !isText(option.currentValue)) return undefined
  const options = uniqueOptions(flattenEntries(option.options).flatMap(readLevel))
  return options.length === 0 ? undefined : { configId: option.id, current: option.currentValue, options }
}

/**
 * Find the CLI's native mode option. Only ACP's category identifies it: the ids differ
 * between CLIs, and a CLI may report no modes at all. The values are kept verbatim so
 * switching sends back an id the CLI itself understands.
 * @param configOptions - the options a CLI reported, if any.
 * @returns its modes, or undefined when it reports none.
 */
export function readModeList(configOptions: ConfigOptions): CliModeList | undefined {
  const option = selectsOf(configOptions).find((candidate) => candidate.category === MODE_CATEGORY)
  if (option === undefined || !isText(option.id) || !isText(option.currentValue)) return undefined
  const options = uniqueOptions(flattenEntries(option.options).flatMap(readLevel))
  return options.length === 0 ? undefined : { configId: option.id, current: option.currentValue, options }
}

/**
 * Find the model option. ACP marks it with a category, so that wins; the id is only
 * a convention, for CLIs that report no category. The SDK does not validate responses,
 * so everything here is checked: an empty name or id in the catalog would make the
 * harness drop the whole CLI from its menus.
 * @param configOptions - the options a CLI reported, if any.
 * @returns the model list, with the CLI's native modes and the active model's reasoning
 * levels when it has any, or undefined when the CLI offers no selectable models.
 */
export function readModelList(configOptions: ConfigOptions): CliModelList | undefined {
  const selects = selectsOf(configOptions)
  const option =
    selects.find((candidate) => candidate.category === MODEL_CATEGORY) ??
    selects.find((candidate) => candidate.category == null && candidate.id === CONVENTIONAL_MODEL_OPTION_ID)
  if (option === undefined || !isText(option.id) || !isText(option.currentValue)) return undefined
  const options = distinguishNames(flattenEntries(option.options).flatMap(readEntry))
  if (options.length === 0) return undefined
  const effort = readEffortList(configOptions)
  const modes = readModeList(configOptions)
  const list: CliModelList = {
    configId: option.id,
    current: option.currentValue,
    options,
    ...(modes === undefined ? {} : { modes }),
    ...(effort === undefined ? {} : { efforts: { [option.currentValue]: effort } }),
  }
  return list
}
