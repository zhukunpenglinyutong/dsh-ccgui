/**
 * Shared names.
 * @module dsh-ccgui/constants
 */

/**
 * The only tool a CLI session calls in the harness. The name is deliberately not
 * one the harness ships, so a CLI call can never reach a real tool body and run a
 * command the CLI already ran.
 */
export const CLI_TOOL_NAME = 'cli_tool'

/** Every CLI's provider route starts with this; the rest is its configured id. */
export const CLI_ROUTE_PREFIX = 'cli-'

/**
 * Name a CLI's provider route.
 * @param id - the configured agent id.
 * @returns its route.
 */
export const cliRoute = (id: string): string => `${CLI_ROUTE_PREFIX}${id}`

/**
 * Whether a provider route is a CLI's rather than one of the harness's own.
 * @param provider - a provider route, or nothing before one is chosen.
 * @returns true for a CLI route.
 */
export const isCliRoute = (provider: string | undefined): boolean => provider?.startsWith(CLI_ROUTE_PREFIX) ?? false

/** A one-line menu row has room for a short numeric label, not a sentence of marketing copy. */
const MAX_COMPACT_DESCRIPTION = 20
/** A decimal point is not prose punctuation: it belongs to a cost multiplier like x0.00. */
const PROSE_PUNCTUATION = /[,;:!?，。；：！？]/

/**
 * The part of a model's description the menu shows beside its name: a compact label such as
 * CodeBuddy's `x0.29 credits`, which tells apart tiers that share a name. Sentences about what
 * a model is good at are left out. The server side decides with the same rule whether such
 * labels can tell same-named rows apart, so a row never relies on text the menu hides.
 * @param description - what the CLI said about the model.
 * @returns the label to show, or undefined when there is none worth showing.
 */
export function compactDescription(description: string | undefined): string | undefined {
  const text = description?.trim() ?? ''
  if (text.length === 0 || text.length > MAX_COMPACT_DESCRIPTION) return undefined
  return PROSE_PUNCTUATION.test(text) || !/\d/.test(text) ? undefined : text
}

/** Model id meaning whatever the CLI itself is set to. */
export const DEFAULT_MODEL_ID = 'default'

/** Path prefix of the 变更 panel's git routes; the browser posts to `<prefix>/<operation>`. */
export const GIT_ROUTE_PREFIX = '/dsh-ccgui/git'

/**
 * The route the composer's mode control posts to. It only lists the modes a CLI reported
 * and sends the chosen id back to that CLI, unchanged.
 */
export const MODE_ROUTE_PREFIX = '/dsh-ccgui/modes'
