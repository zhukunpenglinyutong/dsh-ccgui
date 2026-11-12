import { describe, expect, it } from 'vitest'
import type { DirectoryState } from '../../src/client/choices.ts'
import { isRow, menuModels, rowCount } from '../../src/client/menu-models.ts'

const REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}
const OFFICIAL = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    { id: 'flash', name: 'Flash', reasoning: REASONING },
    { id: 'pro', name: 'Pro' },
  ],
}
const ACCOUNT = { id: 'deepseek-account', name: 'deepseek-account', models: [{ id: 'flash', name: 'Flash' }] }
const OTHER = {
  id: 'acme',
  name: 'Acme',
  models: [{ id: 'a1', name: 'A1', reasoning: { efforts: REASONING.efforts } }],
}
const CLAUDE = {
  id: 'cli-claude',
  name: 'Claude Code',
  models: [
    { id: 'default', name: 'Opus（默认）' },
    { id: 'opus', name: 'Opus' },
  ],
}

const state = (fields: Partial<DirectoryState> = {}): DirectoryState => ({
  groups: [OTHER, CLAUDE, OFFICIAL, ACCOUNT],
  current: { provider: 'deepseek-official', model: 'flash' },
  ...fields,
})

describe('menuModels on a provider the harness runs', () => {
  it('lists every provider but the CLIs, account first and API key second, with headings', () => {
    const models = menuModels(state())
    expect(models.sections.map((section) => section.name)).toEqual(['DeepSeek 账号', 'DeepSeek', 'Acme'])
    expect(models.sections.every((section) => section.headed)).toBe(true)
    expect(models.label).toBe('模型')
    expect(models.unlisted).toBeUndefined()
  })

  // The account and the API key offer the same model ids.
  it('finds the current model by provider and id together', () => {
    const models = menuModels(state())
    expect(models.current).toMatchObject({ provider: 'deepseek-official', model: 'flash' })
  })

  it('offers the current model levels and picks its default', () => {
    const models = menuModels(state())
    expect(models.efforts.map((level) => level.name)).toEqual(['Low', 'High'])
    expect(models.effort?.effort).toBe('high')
  })

  it('follows a level the session chose', () => {
    const current = { provider: 'deepseek-official', model: 'flash', reasoningEffort: 'low' }
    expect(menuModels(state({ current })).effort?.name).toBe('Low')
  })

  it('offers the provider its own choice when the model names no default', () => {
    const models = menuModels(state({ current: { provider: 'acme', model: 'a1' } }))
    expect(models.efforts.map((level) => level.name)).toEqual(['Default', 'Low', 'High'])
    expect(models.effort).toMatchObject({ key: 'provider-default', effort: undefined })
  })

  it('offers no levels for a model without them', () => {
    const models = menuModels(state({ current: { provider: 'deepseek-official', model: 'pro' } }))
    expect(models.efforts).toEqual([])
    expect(models.effort).toBeUndefined()
  })

  it('has no current model before a selection, and says when the catalog is still loading', () => {
    expect(menuModels(state({ current: null })).current).toBeUndefined()
    expect(menuModels(state({ status: 'loading' })).loading).toBe(true)
    expect(menuModels(state({ status: 'ready' })).loading).toBe(false)
  })
})

describe('menuModels on a CLI', () => {
  const onClaude = { provider: 'cli-claude', model: 'opus' }

  it("lists only that CLI's models, without a heading", () => {
    const models = menuModels(state({ current: onClaude }))
    expect(models.sections).toHaveLength(1)
    expect(models.sections[0]?.rows.map((row) => row.name)).toEqual(['Opus（默认）', 'Opus'])
    expect(models.sections[0]?.headed).toBe(false)
    expect(models.label).toBe('Claude Code')
    expect(models.current?.name).toBe('Opus')
    expect(models.efforts).toEqual([])
  })

  // OMP and PI name each model `vendor/model` and list several vendors, with nothing in ACP to group them.
  it('splits a CLI listing several vendors into one headed section each, the unprefixed rows first', () => {
    const omp = {
      id: 'cli-omp',
      name: 'OMP CLI',
      models: [
        { id: 'default', name: 'V4.1 Flash（默认）' },
        { id: 'deepseek/flash', name: 'V4.1 Flash' },
        { id: 'kimi-code/k3', name: 'K3' },
        { id: 'deepseek/pro', name: 'V4 Pro' },
        { id: 'kimi-code/k3-256k', name: 'K3-256k' },
      ],
    }
    const models = menuModels({ groups: [omp], current: { provider: 'cli-omp', model: 'kimi-code/k3' } })
    expect(models.sections.map(({ name, headed }) => ({ name, headed }))).toEqual([
      { name: 'OMP CLI', headed: false },
      { name: 'deepseek', headed: true },
      { name: 'kimi-code', headed: true },
    ])
    expect(models.sections.map((section) => section.rows.map((row) => row.model))).toEqual([
      ['default'],
      ['deepseek/flash', 'deepseek/pro'],
      ['kimi-code/k3', 'kimi-code/k3-256k'],
    ])
    expect(new Set(models.sections.map((section) => section.id)).size).toBe(3)
    expect(models.current).toMatchObject({ provider: 'cli-omp', model: 'kimi-code/k3', name: 'K3' })
  })

  it('keeps a CLI with a single vendor prefix as one list without a heading', () => {
    const kimi = {
      id: 'cli-kimi',
      name: 'Kimi CLI',
      models: [
        { id: 'default', name: 'K3（默认）' },
        { id: 'kimi-code/k3', name: 'K3' },
        { id: 'kimi-code/k3-256k', name: 'K3-256k' },
      ],
    }
    const models = menuModels({ groups: [kimi], current: { provider: 'cli-kimi', model: 'default' } })
    expect(models.sections).toHaveLength(1)
    expect(models.sections[0]).toMatchObject({ name: 'Kimi CLI', headed: false })
    expect(models.sections[0]?.rows).toHaveLength(3)
  })

  it('leaves no empty leading section when every row has a vendor prefix', () => {
    const pi = {
      id: 'cli-pi',
      name: 'PI CLI',
      models: [
        { id: 'deepseek/flash', name: 'Flash' },
        { id: 'kimi-coding/k3', name: 'K3' },
      ],
    }
    const models = menuModels({ groups: [pi], current: { provider: 'cli-pi', model: 'deepseek/flash' } })
    expect(models.sections.map((section) => section.name)).toEqual(['deepseek', 'kimi-coding'])
  })

  it('names the CLI while only its stand-in is listed', () => {
    const waiting = { ...CLAUDE, models: [{ id: 'default', name: 'Claude Code' }] }
    const models = menuModels({ groups: [waiting], current: { provider: 'cli-claude', model: 'default' } })
    expect(models.unlisted).toBe('Claude Code')
  })

  // The host passes the catalog's description through to the browser directory. Keep it
  // on the row so the menu can show a CLI's cost multiplier as small print beside the name.
  it('carries the cost multiplier through without touching the name', () => {
    const priced = {
      ...CLAUDE,
      models: [
        { id: 'default', name: 'Hy4（默认）' },
        { id: 'hy4free', name: 'Hy4', description: 'x0.00 credits' },
        { id: 'hy4std', name: 'Hy4', description: 'x0.29 credits' },
      ],
    }
    const models = menuModels({ groups: [priced], current: { provider: 'cli-claude', model: 'hy4std' } })
    expect(models.sections[0]?.rows.map((row) => row.name)).toEqual(['Hy4（默认）', 'Hy4', 'Hy4'])
    expect(models.sections[0]?.rows.map((row) => row.description)).toEqual([
      undefined,
      'x0.00 credits',
      'x0.29 credits',
    ])
    expect(models.current?.description).toBe('x0.29 credits')
  })
})

describe('row helpers', () => {
  const row = { provider: 'p', model: 'm', name: 'M' }

  it('matches a row on provider and model', () => {
    expect(isRow(row, { provider: 'p', model: 'm' })).toBe(true)
    expect(isRow(row, { provider: 'q', model: 'm' })).toBe(false)
    expect(isRow(row, null)).toBe(false)
  })

  it('counts rows across sections', () => {
    expect(
      rowCount([
        { id: 'a', name: 'A', headed: true, rows: [row, row] },
        { id: 'b', name: 'B', headed: true, rows: [row] },
      ]),
    ).toBe(3)
  })
})
