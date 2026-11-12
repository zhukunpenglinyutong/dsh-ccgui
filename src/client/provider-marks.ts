/**
 * Which mark each provider shows, and which provider a session-list row is on.
 * @module dsh-ccgui/client/provider-marks
 */

import { CLI_ROUTE_PREFIX, cliRoute } from '../constants.ts'

/**
 * A mark the client can draw. Some name a CLI, some name a model vendor. A model whose maker
 * cannot be read falls back to a neutral mark (`unknown`), and `cli` is the generic CLI
 * one for a CLI with no mark of its own.
 */
export type ProviderMarkId =
  | 'opencode'
  | 'omp'
  | 'codex'
  | 'pi'
  | 'claude'
  | 'codebuddy'
  | 'kimi'
  | 'deepseek'
  | 'hunyuan'
  | 'zhipu'
  | 'minimax'
  | 'stepfun'
  | 'xiaomi'
  | 'unknown'
  | 'cli'

/** The fields of a session-list row this plugin reads. */
export interface SessionRowValues {
  /** Read by the startup script control, which keeps one list per working directory. */
  readonly cwd?: string | undefined
  readonly projectionValues?: { readonly modelSelection?: unknown } | undefined
}

const OWN_MARKS: ReadonlyMap<string, ProviderMarkId> = new Map<string, ProviderMarkId>([
  [cliRoute('opencode'), 'opencode'],
  [cliRoute('omp'), 'omp'],
  [cliRoute('codex'), 'codex'],
  [cliRoute('pi'), 'pi'],
  [cliRoute('claude'), 'claude'],
  [cliRoute('codebuddy'), 'codebuddy'],
  [cliRoute('kimi'), 'kimi'],
])

/** @returns the CLI routes that have a mark of their own, so a test can check them against the bundled CLIs. */
export function ownMarkRoutes(): readonly string[] {
  return [...OWN_MARKS.keys()]
}

/**
 * Pick a provider's mark.
 * @param provider - a provider route.
 * @returns its mark, or undefined for a provider nothing is known about, since claiming
 * a brand for it would mislabel it. The official DeepSeek route is `deepseek-official`,
 * and people add their own routes to it.
 */
export function markOf(provider: string): ProviderMarkId | undefined {
  const own = OWN_MARKS.get(provider)
  if (own !== undefined) return own
  if (provider.startsWith(CLI_ROUTE_PREFIX)) return 'cli'
  return /deepseek/i.test(provider) ? 'deepseek' : undefined
}

function providerIn(selection: unknown): string | undefined {
  const provider = (selection as { provider?: unknown } | null | undefined)?.provider
  return typeof provider === 'string' ? provider : undefined
}

/**
 * Read which provider a session is on. A cold row's cached block may omit any key.
 * @param row - the session's list row, if it has one.
 * @returns the provider the next turn will use, else the one last used.
 */
export function providerOfSession(row: SessionRowValues | undefined): string | undefined {
  const selection = row?.projectionValues?.modelSelection as { next?: unknown; lastUsed?: unknown } | null | undefined
  return providerIn(selection?.next) ?? providerIn(selection?.lastUsed)
}
