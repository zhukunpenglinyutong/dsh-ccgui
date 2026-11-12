/**
 * What the composer's model control lists on a CLI session: that CLI's own models. The
 * harness-provider branch is still derived here, so callers such as the mode seat can resolve
 * the current selection, but a session the harness runs no longer renders this menu: it keeps
 * its native model seat, which also carries settings such as the agent-team toggle. The
 * harness's own seat lists every provider in its one global catalog and offers no way to
 * narrow it per session, which is why a CLI session needs a control of its own. On a harness
 * session a style rule hides just that catalog's CLI groups (see model-menu-styles.ts), so
 * the native seat keeps its own providers and settings without offering a move it cannot make.
 * @module dsh-ccgui/client/menu-models
 */

import { CLI_ROUTE_PREFIX } from '../constants.ts'
import { cliModels } from './choices.ts'
import type { DirectoryGroup, DirectoryReasoning, DirectorySelection, DirectoryState } from './choices.ts'

const ACCOUNT_PROVIDER_ID = 'deepseek-account'
const OFFICIAL_PROVIDER_ID = 'deepseek-official'
/** The harness renames this group in its own menu; this one follows. */
const ACCOUNT_PROVIDER_NAME = 'DeepSeek 账号'
const MENU_LABEL = '模型'
/** The harness's own label for letting the provider pick the level, untranslated there too. */
const PROVIDER_DEFAULT_LABEL = 'Default'
const PROVIDER_DEFAULT_KEY = 'provider-default'
const LOADING_STATUS = 'loading'
/** Splits a CLI model id such as `deepseek/deepseek-flash` into its vendor and the rest. */
const VENDOR_SEPARATOR = '/'
/** Fewer vendors than this leave a CLI's list whole, as one heading would only repeat the CLI. */
const MIN_VENDOR_SECTIONS = 2

/** One model row, which only the provider and the model id together identify. */
export interface MenuRow {
  readonly provider: string
  readonly model: string
  readonly name: string
  /** Compact label shown beside the name, e.g. a CLI's usage cost multiplier; prose is left out. */
  readonly description?: string
  readonly reasoning?: DirectoryReasoning
}

/** One provider's rows, or one vendor's within a CLI. */
export interface MenuSection {
  readonly id: string
  readonly name: string
  /** Whether the section shows its name above its rows. */
  readonly headed: boolean
  readonly rows: readonly MenuRow[]
}

/** One reasoning level; `effort` is undefined for the provider's own choice. */
export interface EffortLevel {
  readonly key: string
  readonly effort: string | undefined
  readonly name: string
}

/** Everything the model control renders. */
export interface MenuModels {
  /** Names the open card for assistive technology. */
  readonly label: string
  readonly sections: readonly MenuSection[]
  readonly current: MenuRow | undefined
  /** The catalog has not arrived yet, so a missing current model is not yet a missing one. */
  readonly loading: boolean
  /** Names the CLI whose list is still the stand-in it has before reporting its models. */
  readonly unlisted: string | undefined
  /** The current model's levels; empty when it advertises none. */
  readonly efforts: readonly EffortLevel[]
  readonly effort: EffortLevel | undefined
}

/**
 * Tell whether a row is the given selection.
 * @param row - a row.
 * @param selection - a selection, if any.
 * @returns true when both name the same provider and model.
 */
export function isRow(
  row: MenuRow,
  selection: Pick<DirectorySelection, 'provider' | 'model'> | null | undefined,
): boolean {
  return row.provider === selection?.provider && row.model === selection.model
}

/**
 * Count the rows, which decides whether the card offers search.
 * @param sections - the sections to count.
 * @returns the number of rows across them.
 */
export function rowCount(sections: readonly MenuSection[]): number {
  return sections.reduce((count, section) => count + section.rows.length, 0)
}

function toSection({ id, name, models }: DirectoryGroup, headed: boolean): MenuSection {
  return {
    id,
    name: id === ACCOUNT_PROVIDER_ID ? ACCOUNT_PROVIDER_NAME : name,
    headed,
    rows: models.map(({ id: model, name: modelName, description, reasoning }) => ({
      provider: id,
      model,
      name: modelName,
      ...(description === undefined ? {} : { description }),
      ...(reasoning === undefined ? {} : { reasoning }),
    })),
  }
}

/** The same order as the harness's menu: the account first, the API key second, the rest as listed. */
const providerRank = (id: string): number => (id === ACCOUNT_PROVIDER_ID ? 0 : id === OFFICIAL_PROVIDER_ID ? 1 : 2)

function effortLevels(reasoning: DirectoryReasoning | undefined): readonly EffortLevel[] {
  if (reasoning === undefined) return []
  const levels = reasoning.efforts.map(({ id, name }) => ({ key: `effort:${id}`, effort: id, name }))
  if (reasoning.defaultEffort !== undefined) return levels
  return [{ key: PROVIDER_DEFAULT_KEY, effort: undefined, name: PROVIDER_DEFAULT_LABEL }, ...levels]
}

function vendorOf(row: MenuRow): string | undefined {
  const at = row.model.indexOf(VENDOR_SEPARATOR)
  return at > 0 ? row.model.slice(0, at) : undefined
}

/**
 * ACP has no field saying which vendor a CLI model comes from, and OMP, PI and OpenCode list
 * several vendors in one flat list. Their ids carry it as a `vendor/` prefix, so a list with
 * more than one prefix is shown under one heading per vendor, the way those CLIs show it.
 * Rows without a prefix, the default entry among them, stay on top without a heading.
 */
function vendorSections(section: MenuSection): readonly MenuSection[] {
  const vendors = [...new Set(section.rows.flatMap((row) => vendorOf(row) ?? []))]
  if (vendors.length < MIN_VENDOR_SECTIONS) return [section]
  const loose = section.rows.filter((row) => vendorOf(row) === undefined)
  const lead = loose.length === 0 ? [] : [{ ...section, rows: loose }]
  return [
    ...lead,
    ...vendors.map((vendor) => ({
      id: `${section.id}${VENDOR_SEPARATOR}${vendor}`,
      name: vendor,
      headed: true,
      rows: section.rows.filter((row) => vendorOf(row) === vendor),
    })),
  ]
}

type Listing = Pick<MenuModels, 'label' | 'sections' | 'unlisted'>

function listing(state: DirectoryState): Listing {
  const cli = cliModels(state)
  if (cli !== undefined) {
    const section = toSection({ id: cli.provider, name: cli.name, models: cli.rows }, false)
    return { label: cli.name, sections: vendorSections(section), unlisted: cli.listed ? undefined : cli.name }
  }
  const sections = state.groups
    .filter((group) => !group.id.startsWith(CLI_ROUTE_PREFIX))
    .map((group) => toSection(group, true))
    .sort((left, right) => providerRank(left.id) - providerRank(right.id))
  return { label: MENU_LABEL, sections, unlisted: undefined }
}

/**
 * List what the model control offers a session.
 * @param state - the session's model directory.
 * @returns the sections, the current model and its reasoning levels.
 */
export function menuModels(state: DirectoryState): MenuModels {
  const listed = listing(state)
  const current = listed.sections.flatMap((section) => section.rows).find((row) => isRow(row, state.current))
  const efforts = effortLevels(current?.reasoning)
  const chosen = state.current?.reasoningEffort ?? current?.reasoning?.defaultEffort
  return {
    ...listed,
    current,
    loading: state.status === LOADING_STATUS,
    efforts,
    effort: efforts.find((level) => level.effort === chosen),
  }
}
