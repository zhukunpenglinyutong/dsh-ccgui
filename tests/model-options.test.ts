import { describe, expect, it } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { readEffortList, readModeList, readModelList } from '../src/model-options.ts'

const select = (fields: object): SessionConfigOption => ({
  id: 'model',
  name: 'Model',
  type: 'select',
  currentValue: 'a',
  options: [
    { value: 'a', name: 'A' },
    { value: 'b', name: 'B' },
  ],
  ...fields,
})

describe('readModelList', () => {
  it('reads the model option', () => {
    expect(readModelList([select({ category: 'model' })])).toEqual({
      configId: 'model',
      current: 'a',
      options: [
        { value: 'a', name: 'A' },
        { value: 'b', name: 'B' },
      ],
    })
  })

  // ACP names the category; the id is only a convention, so a CLI may use another.
  it('finds it by category under any id', () => {
    expect(readModelList([select({ id: 'llm', category: 'model' })])?.configId).toBe('llm')
  })

  it('prefers the category over an option merely called model', () => {
    const decoy = select({ id: 'model', category: 'mode' })
    const real = select({ id: 'llm', category: 'model' })
    expect(readModelList([decoy, real])?.configId).toBe('llm')
  })

  it('falls back to the conventional id', () => {
    expect(readModelList([select({})])?.configId).toBe('model')
  })

  it('flattens grouped options', () => {
    const grouped = select({
      options: [
        { group: 'x', name: 'X', options: [{ value: 'a', name: 'A' }] },
        { group: 'y', name: 'Y', options: [{ value: 'b', name: 'B' }] },
      ],
    })
    expect(readModelList([grouped])?.options).toEqual([
      { value: 'a', name: 'A' },
      { value: 'b', name: 'B' },
    ])
  })

  // Recorded from claude-agent-acp: only the description says which model this entry is.
  it('names a default entry after the model it describes', () => {
    const options = [
      { value: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
      { value: 'haiku', name: 'Haiku 5.5', description: 'Fastest for quick answers' },
    ]
    expect(readModelList([select({ category: 'model', currentValue: 'default', options })])?.options).toEqual([
      { value: 'default', name: 'Opus 5.5' },
      { value: 'haiku', name: 'Haiku 5.5', description: 'Fastest for quick answers' },
    ])
  })

  it.each([[undefined], [''], [5]])('keeps the name of a default entry whose description is %s', (description) => {
    const options = [{ value: 'default', name: 'Auto', description }]
    expect(readModelList([select({ category: 'model', currentValue: 'default', options })])?.options).toEqual([
      { value: 'default', name: 'Auto' },
    ])
  })

  // Recorded from CodeBuddy: the description carries the usage cost multiplier. Names
  // stay as the CLI gave them; the menu shows the multiplier beside each name, which is
  // also what tells the two Hy4 tiers apart.
  it('keeps descriptions beside clean names, even for models that share a name', () => {
    const options = [
      { value: 'hy4free', name: 'Hy4', description: 'x0.00 credits' },
      { value: 'hy4std', name: 'Hy4', description: 'x0.29 credits' },
      { value: 'glm', name: 'GLM', description: 'x0.69 credits' },
    ]
    expect(readModelList([select({ category: 'model', currentValue: 'hy4free', options })])?.options).toEqual([
      { value: 'hy4free', name: 'Hy4', description: 'x0.00 credits' },
      { value: 'hy4std', name: 'Hy4', description: 'x0.29 credits' },
      { value: 'glm', name: 'GLM', description: 'x0.69 credits' },
    ])
  })

  it('falls back to the ids when the descriptions do not tell them apart', () => {
    const options = [
      { value: 'hy3', name: 'Hy3', description: 'same' },
      { value: 'hy3-x', name: 'Hy3', description: 'same' },
      { value: 'k', name: 'K' },
      { value: 'k-fast', name: 'K' },
    ]
    expect(readModelList([select({ category: 'model', currentValue: 'hy3', options })])?.options).toEqual([
      { value: 'hy3', name: 'Hy3 · hy3', description: 'same' },
      { value: 'hy3-x', name: 'Hy3 · hy3-x', description: 'same' },
      { value: 'k', name: 'K · k' },
      { value: 'k-fast', name: 'K · k-fast' },
    ])
  })

  // The menu shows only a compact label beside a name and leaves prose out, so prose cannot
  // be what tells two rows apart: they would read the same. The ids have to do it.
  it('falls back to the ids when the descriptions are prose the menu leaves out', () => {
    const options = [
      { value: 'hy4-free', name: 'Hy4', description: 'Free tier, limited quota' },
      { value: 'hy4', name: 'Hy4', description: 'Stronger agentic coding' },
    ]
    expect(readModelList([select({ category: 'model', currentValue: 'hy4', options })])?.options).toEqual([
      { value: 'hy4-free', name: 'Hy4 · hy4-free', description: 'Free tier, limited quota' },
      { value: 'hy4', name: 'Hy4 · hy4', description: 'Stronger agentic coding' },
    ])
  })

  // The menu labels the default entry on its own, so sharing a name with its model is expected.
  it('leaves a default entry that names the model it stands for', () => {
    const options = [
      { value: 'default', name: 'Default', description: 'Opus 5.5' },
      { value: 'opus', name: 'Opus 5.5', description: 'Most capable' },
    ]
    expect(readModelList([select({ category: 'model', currentValue: 'default', options })])?.options).toEqual([
      { value: 'default', name: 'Opus 5.5' },
      { value: 'opus', name: 'Opus 5.5', description: 'Most capable' },
    ])
  })

  it('ignores options that are not selects', () => {
    const toggle = { id: 'model', name: 'Model', type: 'boolean', currentValue: true } as unknown as SessionConfigOption
    expect(readModelList([toggle])).toBeUndefined()
  })

  it('finds nothing when the CLI lists no models', () => {
    expect(readModelList([select({ options: [] })])).toBeUndefined()
    expect(readModelList([select({ id: 'mode', category: 'mode' })])).toBeUndefined()
    expect(readModelList([])).toBeUndefined()
    expect(readModelList(undefined)).toBeUndefined()
  })
})

// The SDK does not validate responses, so these come straight from the CLI.
describe('readModelList with values a CLI should not have sent', () => {
  const asOptions = (value: unknown) => value as readonly SessionConfigOption[]

  it.each([
    ['a non-list', {}],
    ['a list of junk', [null, 'x', 5]],
    ['an option with no options', [select({ category: 'model', options: undefined })]],
    ['an option with non-list options', [select({ category: 'model', options: 'a,b' })]],
    ['an option with no current value', [select({ category: 'model', currentValue: undefined })]],
    ['an option with an empty current value', [select({ category: 'model', currentValue: '' })]],
    ['an option with no usable id', [select({ category: 'model', id: 5 })]],
    [
      'an option whose entries are all unusable',
      [select({ category: 'model', options: [{ value: '' }, { name: 'x' }] })],
    ],
  ])('finds no list in %s', (_name, value) => {
    expect(readModelList(asOptions(value))).toBeUndefined()
  })

  it('drops the entries it cannot use and keeps the rest', () => {
    const options = [
      null,
      'x',
      { value: '', name: 'empty' },
      { name: 'none' },
      { value: 5, name: 'number' },
      { value: 'ok', name: 'OK' },
    ]
    expect(readModelList(asOptions([select({ category: 'model', options })]))?.options).toEqual([
      { value: 'ok', name: 'OK' },
    ])
  })

  it.each([[undefined], [''], [5]])('names an entry after its value when its name is %s', (name) => {
    const options = [{ value: 'a', name }]
    expect(readModelList(asOptions([select({ category: 'model', options })]))?.options).toEqual([
      { value: 'a', name: 'a' },
    ])
  })

  it('skips a group whose options are not a list', () => {
    const options = [
      { group: 'g', name: 'G', options: 'nope' },
      { value: 'a', name: 'A' },
    ]
    expect(readModelList(asOptions([select({ category: 'model', options })]))?.options).toEqual([
      { value: 'a', name: 'A' },
    ])
  })
})

describe('readEffortList', () => {
  const effort = (fields: object): SessionConfigOption =>
    select({
      id: 'thinking',
      category: 'thought_level',
      currentValue: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
      ...fields,
    })

  it('reads the thought level option under whatever id the CLI gives it', () => {
    expect(readEffortList([select({ category: 'model' }), effort({})])).toEqual({
      configId: 'thinking',
      current: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    })
  })

  // The category is the only thing ACP fixes; an id that merely looks right is not enough.
  it('ignores an option without the thought level category', () => {
    expect(readEffortList([effort({ category: 'model_config', id: 'effort' })])).toBeUndefined()
  })

  it('reads nothing from a CLI that reports no options', () => {
    expect(readEffortList(undefined)).toBeUndefined()
    expect(readEffortList(null)).toBeUndefined()
  })

  it('reads nothing from an option with no usable levels or no current value', () => {
    expect(readEffortList([effort({ options: [{ value: '', name: 'x' }] })])).toBeUndefined()
    expect(readEffortList([effort({ currentValue: '' })])).toBeUndefined()
  })

  it('drops repeated levels, which the harness would reject', () => {
    const options = [
      { value: 'low', name: 'Low' },
      { value: 'low', name: 'Low again' },
    ]
    expect(readEffortList([effort({ currentValue: 'low', options })])?.options).toEqual([{ value: 'low', name: 'Low' }])
  })
})

describe('readModelList with thought levels', () => {
  const thinking: SessionConfigOption = {
    id: 'thinking',
    name: 'Thinking',
    type: 'select',
    category: 'thought_level',
    currentValue: 'max',
    options: [
      { value: 'high', name: 'High' },
      { value: 'max', name: 'Max' },
    ],
  }

  it('records the levels of the model that is active', () => {
    expect(readModelList([select({ category: 'model' }), thinking])?.efforts).toEqual({
      a: {
        configId: 'thinking',
        current: 'max',
        options: [
          { value: 'high', name: 'High' },
          { value: 'max', name: 'Max' },
        ],
      },
    })
  })

  it('leaves levels out for a CLI that offers none', () => {
    expect(readModelList([select({ category: 'model' })])).not.toHaveProperty('efforts')
  })
})

// A CLI's modes are its own vocabulary. Nothing here renames an id or folds it into a
// harness preset: switching sends these values back to the CLI unchanged.
describe('readModeList', () => {
  const modes = select({
    id: 'permission_mode',
    name: 'Permission mode',
    category: 'mode',
    currentValue: 'acceptEdits',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'acceptEdits', name: 'Accept edits' },
      { value: 'plan', name: 'Plan' },
    ],
  })

  const expected = {
    configId: 'permission_mode',
    current: 'acceptEdits',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'acceptEdits', name: 'Accept edits' },
      { value: 'plan', name: 'Plan' },
    ],
  }

  it('keeps the CLI ids, names and current value verbatim', () => {
    expect(readModeList([select({ category: 'model' }), modes])).toEqual(expected)
  })

  it('attaches the modes to the model list without changing the models', () => {
    expect(readModelList([select({ category: 'model' }), modes])).toEqual({
      configId: 'model',
      current: 'a',
      options: [
        { value: 'a', name: 'A' },
        { value: 'b', name: 'B' },
      ],
      modes: expected,
    })
  })

  it('finds modes by category, never by an id that merely looks like one', () => {
    expect(readModeList([select({ id: 'mode' })])).toBeUndefined()
  })

  it('returns undefined when the CLI reports no modes', () => {
    expect(readModeList([select({ category: 'model' })])).toBeUndefined()
    expect(readModeList([])).toBeUndefined()
    expect(readModeList(undefined)).toBeUndefined()
  })

  it('does not mistake models or thought levels for modes', () => {
    expect(readModeList([select({ category: 'model' }), select({ category: 'thought_level' })])).toBeUndefined()
  })

  it('drops duplicate mode ids but keeps the first of each', () => {
    const duplicated = select({
      category: 'mode',
      currentValue: 'plan',
      options: [
        { value: 'plan', name: 'Plan' },
        { value: 'plan', name: 'Plan again' },
      ],
    })
    expect(readModeList([duplicated])?.options).toEqual([{ value: 'plan', name: 'Plan' }])
  })

  it('ignores a mode option with no usable id or current value', () => {
    expect(readModeList([select({ category: 'mode', id: 5 })])).toBeUndefined()
    expect(readModeList([select({ category: 'mode', currentValue: '' })])).toBeUndefined()
  })
})
