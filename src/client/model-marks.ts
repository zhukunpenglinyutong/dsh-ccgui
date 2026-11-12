/**
 * Which vendor mark a model row shows in the model menu. A CLI such as OpenCode lists
 * models from many vendors under one provider, so the mark is read from the model itself
 * and the provider's own mark is only the fallback.
 * @module dsh-ccgui/client/model-marks
 */

import { markOf } from './provider-marks.ts'
import type { ProviderMarkId } from './provider-marks.ts'

/** The fields of a row this reads; the id and the display name are matched together. */
export interface ModelIdentity {
  readonly provider: string
  readonly model: string
  readonly name: string
}

// Short family names (K3, o4, Hy4) only count at the start of a word, so `pro3` or
// `polk2` stay unclaimed. DeepSeek comes first: its names never contain the others' hints.
// These are the makers whose models a CLI may aggregate, not the CLI itself.
const FAMILIES: readonly (readonly [ProviderMarkId, RegExp])[] = [
  ['deepseek', /deepseek/i],
  ['hunyuan', /(?:^|[\s/_.-])hy\d|hunyuan|混元/i],
  ['zhipu', /glm[-_]?\d|zhipu|chatglm|智谱/i],
  ['minimax', /minimax/i],
  ['stepfun', /stepfun|阶跃|(?:^|[\s/_.-])step[-_ ]?\d/i],
  ['xiaomi', /mimo|xiaomi|小米/i],
  ['kimi', /kimi|moonshot|(?:^|[\s/_.-])k\d/i],
  ['claude', /claude|(?:^|[\s/_.-])(?:opus|sonnet|haiku)(?:$|[\s/_.-]|\d)/i],
  ['codex', /gpt|codex|openai|(?:^|[\s/_.-])o\d(?:$|[\s/_.-])/i],
]

/** Marks that name a model's maker. A CLI's own brand is not one of them. */
const VENDOR_MARKS: ReadonlySet<ProviderMarkId> = new Set<ProviderMarkId>([
  'deepseek',
  'hunyuan',
  'zhipu',
  'minimax',
  'stepfun',
  'xiaomi',
  'kimi',
  'claude',
  'codex',
])

/**
 * Pick a model row's mark.
 * @param row - the row's provider, model id and display name.
 * @returns the maker the model is recognised as, else the provider's mark when the provider
 * *is* that maker, else a neutral mark as a placeholder for a CLI's unidentifiable model,
 * else undefined. An aggregator CLI's logo never stands in for the model's maker: CodeBuddy
 * lists Hunyuan, Zhipu and MiniMax side by side, and an anonymous model has no logo to claim.
 */
export function modelMarkOf({ provider, model, name }: ModelIdentity): ProviderMarkId | undefined {
  const text = `${model} ${name}`
  const family = FAMILIES.find(([, pattern]) => pattern.test(text))
  if (family !== undefined) return family[0]
  const own = markOf(provider)
  if (own === undefined) return undefined
  return VENDOR_MARKS.has(own) ? own : 'unknown'
}
