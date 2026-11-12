/**
 * What the model menu shows for each CLI. Asking a CLI means starting it, which can
 * take a while on a cold `npx` and for that command downloads and runs a package. So
 * filling the menu never asks: a CLI is only started once someone has chosen it, and
 * the menu refreshes when the answer arrives. Answers are saved, so a restarted plugin
 * can show the last known lists while it asks again.
 * @module dsh-ccgui/model-catalog
 */

import type { LlmModelInfo, LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { DEFAULT_MODEL_ID } from './constants.ts'
import { learnEfforts, reasoningFor } from './model-efforts.ts'
import { olderVersions } from './model-versions.ts'
import type { CliEffortList, CliModeList, CliModelList, CliModelOption } from './model-options.ts'

/** What the catalog needs from the bridge. */
export interface ModelCatalogDeps {
  labelFor(provider: string): string | undefined
  probe(provider: string): Promise<CliModelList | undefined>
  /** The list for this route changed; the harness then refreshes its menus. */
  onUpdated(provider: string): void
  warn(message: string): void
  /** Keep every known list for the next run. */
  save(lists: ReadonlyMap<string, CliModelList>): Promise<void>
}

/**
 * The menu keeps a CLI's compact usage-cost label as small print beside the name, so names
 * stay exactly as the CLI gave them. Longer prose about a model is left out of the row;
 * the catalog still carries it for the harness.
 */
function modelInfo(provider: string, option: CliModelOption): LlmModelInfo {
  return {
    provider,
    id: option.value,
    name: option.name,
    ...(option.description === undefined ? {} : { description: option.description }),
  }
}

function nameOf(list: CliModelList, value: string): string {
  return list.options.find((candidate) => candidate.value === value)?.name ?? value
}

/**
 * Names whose rows are told apart by their descriptions rather than being duplicates.
 * CodeBuddy lists free and paid tiers of Hy4 under the same name, with `x0.00 credits`
 * and `x0.29 credits` beside them; filtering those as aliases would hide a real choice.
 */
function pricedTiers(options: readonly CliModelOption[]): ReadonlySet<string> {
  return new Set(
    [...new Set(options.map(({ name }) => name))].filter((name) => {
      const descriptions = new Set(
        options.filter((option) => option.name === name).map(({ description }) => description),
      )
      return descriptions.size > 1 && !descriptions.has(undefined)
    }),
  )
}

/**
 * The harness rejects a catalog with duplicate ids, which would drop the whole CLI. A model
 * named like the default row is left out too: choosing the default switches to the model it
 * names, so the row would repeat it. Claude Code's `opus` alias is such a row while it
 * resolves to the same model as its `default`; if the two part ways, their names do as well.
 * Older versions are left out as well; they stay resolvable for a session already on one.
 * Rows that share a name but carry distinct descriptions are none of these: they are
 * differently priced tiers the user can only tell apart in the menu.
 */
function selectableOptions(list: CliModelList): readonly CliModelOption[] {
  const { options } = list
  const defaultName = nameOf(list, list.current)
  const older = olderVersions(options.map(({ name }) => name))
  const tiers = pricedTiers(options)
  return options.filter(
    ({ value, name }, index) =>
      value !== DEFAULT_MODEL_ID &&
      (name !== defaultName || tiers.has(name)) &&
      !older.has(name) &&
      options.findIndex((option) => option.value === value) === index,
  )
}

/** Remembers each CLI's models, seeded from the lists an earlier run saved. */
export class CliModelCatalog {
  private lists: ReadonlyMap<string, CliModelList> = new Map()
  private asked: ReadonlySet<string> = new Set()
  /** Routes this run has a CLI's own answer for, as opposed to a restored list. */
  private answered: ReadonlySet<string> = new Set()

  constructor(private readonly deps: ModelCatalogDeps) {}

  /**
   * List a CLI's models. The default entry names the model it stands for, so the menu
   * always shows what is really in use.
   * @param provider - a CLI route.
   * @returns the default entry, followed by the other models once they are known.
   */
  listModels(provider: string): readonly LlmModelInfo[] {
    const list = this.lists.get(provider)
    if (list === undefined) {
      return [{ provider, id: DEFAULT_MODEL_ID, name: this.deps.labelFor(provider) ?? provider }]
    }
    return [
      { provider, id: DEFAULT_MODEL_ID, name: this.defaultName(list) },
      ...selectableOptions(list).map((option) => modelInfo(provider, option)),
    ]
  }

  /**
   * The reasoning levels of one model. The harness reads these through model resolution,
   * not the listing, both for its menus and to check a chosen level.
   * @param provider - a CLI route.
   * @param model - a model id.
   * @returns its levels, or undefined when none are known.
   */
  reasoning(provider: string, model: string): LlmModelReasoningInfo | undefined {
    const list = this.lists.get(provider)
    return list === undefined ? undefined : reasoningFor(list, model)
  }

  /**
   * Record the levels a session saw on its active model, which may differ from those the
   * menu assumed for it. Kept and saved like an answer, and the menu refreshes.
   * @param provider - a CLI route.
   * @param model - the model that was active.
   * @param effort - its levels, or undefined when it offers none.
   */
  learnEfforts(provider: string, model: string, effort: CliEffortList | undefined): void {
    const list = this.lists.get(provider)
    // Without a list the menu has no models to attach levels to; the probe brings both.
    if (list === undefined) return
    const learned = learnEfforts(list, model, effort)
    if (learned === list) return
    this.lists = new Map([...this.lists, [provider, learned]])
    this.persist()
    this.deps.onUpdated(provider)
  }

  /**
   * Name one model.
   * @param provider - a CLI route.
   * @param model - a model id.
   * @returns its display name, falling back to the id.
   */
  modelName(provider: string, model: string): string {
    const list = this.lists.get(provider)
    if (list === undefined) return model
    return model === DEFAULT_MODEL_ID ? this.defaultName(list) : nameOf(list, model)
  }

  /**
   * Read what a CLI reported.
   * @param provider - a CLI route.
   * @returns its model list, once known.
   */
  known(provider: string): CliModelList | undefined {
    return this.lists.get(provider)
  }

  /**
   * The CLI's own modes, kept per route. Each CLI has a different set and different ids;
   * callers must send those ids back unchanged rather than translating them into any
   * harness preset.
   * @param provider - a CLI route.
   * @returns its native modes, or undefined before the CLI has answered.
   */
  modesFor(provider: string): CliModeList | undefined {
    return this.lists.get(provider)?.modes
  }

  /**
   * Record the native modes a CLI reported for its own route. Only that route's list
   * changes: another CLI keeps its own modes, and no id is translated.
   * @param provider - a CLI route.
   * @param modes - the modes in the CLI's own ids and names.
   */
  learnModes(provider: string, modes: CliModeList): void {
    const list = this.lists.get(provider)
    // Without a model list there is nowhere to keep them; the probe brings both.
    if (list === undefined || JSON.stringify(list.modes) === JSON.stringify(modes)) return
    this.lists = new Map([...this.lists, [provider, { ...list, modes }]])
    this.persist()
    this.deps.onUpdated(provider)
  }

  /**
   * Ask a CLI for its models in the background, unless that is done or under way. A
   * failed attempt can be repeated: the user may have installed it or logged in since.
   * @param provider - a CLI route someone has chosen.
   */
  ensureListed(provider: string): void {
    if (this.asked.has(provider)) return
    this.asked = new Set([...this.asked, provider])
    this.deps
      .probe(provider)
      .then((answer) => {
        if (answer === undefined) return
        this.lists = new Map([...this.lists, [provider, this.withLearned(provider, answer)]])
        this.answered = new Set([...this.answered, provider])
        this.persist()
        this.deps.onUpdated(provider)
      })
      .catch((error: unknown) => {
        if (!this.answered.has(provider)) this.asked = new Set([...this.asked].filter((asked) => asked !== provider))
        this.deps.warn(`ccgui: could not list models for ${provider}: ${String(error)}`)
      })
  }

  /**
   * Show the lists an earlier run saved. They may be out of date, so they never replace
   * an answer from this run and do not stop the CLI from being asked when chosen.
   * @param saved - lists by provider route; routes no longer configured are skipped.
   */
  restore(saved: ReadonlyMap<string, CliModelList>): void {
    const restored = [...saved].filter(
      ([provider]) => !this.answered.has(provider) && this.deps.labelFor(provider) !== undefined,
    )
    this.lists = new Map([...this.lists, ...restored])
    for (const [provider] of restored) this.deps.onUpdated(provider)
  }

  /**
   * The probe only sees the default model, so what sessions learned about the others still
   * holds; for the default model the answer wins, including when it now offers no levels.
   */
  private withLearned(provider: string, answer: CliModelList): CliModelList {
    const learned = this.lists.get(provider)?.efforts
    if (learned === undefined) return answer
    const own = answer.efforts?.[answer.current] ?? null
    return { ...answer, efforts: { ...learned, [answer.current]: own } }
  }

  private persist(): void {
    this.deps.save(this.lists).catch((error: unknown) => {
      this.deps.warn(`ccgui: could not save model lists: ${String(error)}`)
    })
  }

  private defaultName(list: CliModelList): string {
    return `${nameOf(list, list.current)}（默认）`
  }
}
