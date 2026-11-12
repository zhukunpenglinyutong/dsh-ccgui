import { describe, expect, it, vi } from 'vitest'
import { CliModelCatalog } from '../src/model-catalog.ts'
import type { CliModelList } from '../src/model-options.ts'

const LIST: CliModelList = {
  configId: 'model',
  current: 'small',
  options: [
    { value: 'small', name: 'Small' },
    { value: 'large', name: 'Large' },
  ],
}

function setup(probe: (provider: string) => Promise<CliModelList | undefined> = () => Promise.resolve(LIST)) {
  const deps = {
    labelFor: vi.fn((_provider: string): string | undefined => 'X CLI'),
    probe: vi.fn(probe),
    onUpdated: vi.fn(),
    warn: vi.fn(),
    save: vi.fn((_lists: ReadonlyMap<string, CliModelList>) => Promise.resolve()),
  }
  return { deps, catalog: new CliModelCatalog(deps) }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('CliModelCatalog', () => {
  // Filling the menu must not run anything: for `npx` commands that would download and
  // execute a package the user never chose.
  it('starts no CLI just to fill the menu', () => {
    const { catalog, deps } = setup()
    expect(catalog.listModels('cli-x')).toEqual([{ provider: 'cli-x', id: 'default', name: 'X CLI' }])
    expect(deps.probe).not.toHaveBeenCalled()
  })

  it('asks in the background when requested, without waiting for the answer', () => {
    const { catalog, deps } = setup(() => new Promise(() => {}))
    catalog.ensureListed('cli-x')
    expect(deps.probe).toHaveBeenCalledWith('cli-x')
    expect(catalog.listModels('cli-x')).toHaveLength(1)
  })

  // The default row already stands for the active model, so a row of its own would repeat it.
  it('lists the real models once it knows them, naming the active one as default', async () => {
    const { catalog } = setup()
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x')).toEqual([
      { provider: 'cli-x', id: 'default', name: 'Small（默认）' },
      { provider: 'cli-x', id: 'large', name: 'Large' },
    ])
  })

  // Claude Code lists its own `default` and the `opus` alias, which resolve to the same model.
  it('leaves out an alias that names the same model as the default row', async () => {
    const { catalog } = setup(() =>
      Promise.resolve({
        configId: 'model',
        current: 'default',
        options: [
          { value: 'default', name: 'Opus 5.5' },
          { value: 'opus', name: 'Opus 5.5' },
          { value: 'sonnet', name: 'Sonnet 5.5' },
        ],
      }),
    )
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x').map((model) => model.name)).toEqual(['Opus 5.5（默认）', 'Sonnet 5.5'])
    expect(catalog.modelName('cli-x', 'opus')).toBe('Opus 5.5')
  })

  // Pinned older versions sit beside the current ones, read as duplicates and are of little use.
  it('leaves out models a newer version replaces', async () => {
    const { catalog } = setup(() =>
      Promise.resolve({
        configId: 'model',
        current: 'default',
        options: [
          { value: 'default', name: 'Opus 5.5' },
          { value: 'sonnet', name: 'Sonnet 5.5' },
          { value: 'claude-opus-5', name: 'Opus 5' },
          { value: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
        ],
      }),
    )
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x').map((model) => model.name)).toEqual(['Opus 5.5（默认）', 'Sonnet 5.5'])
    // A session already on one, resumed say, still shows its name.
    expect(catalog.modelName('cli-x', 'claude-opus-5')).toBe('Opus 5')
  })

  // CodeBuddy reports the usage cost multiplier as each option's description. The menu
  // shows it as small print beside the name, so the catalog keeps the two fields apart.
  it('keeps names clean and exposes the cost multiplier as a description', async () => {
    const priced: CliModelList = {
      configId: 'model',
      current: 'hy4std',
      options: [
        { value: 'hy4free', name: 'Hy4', description: 'x0.00 credits' },
        { value: 'hy4std', name: 'Hy4', description: 'x0.29 credits' },
        { value: 'glm', name: 'GLM', description: 'x0.69 credits' },
      ],
    }
    const { catalog } = setup(() => Promise.resolve(priced))
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x')).toEqual([
      { provider: 'cli-x', id: 'default', name: 'Hy4（默认）' },
      { provider: 'cli-x', id: 'hy4free', name: 'Hy4', description: 'x0.00 credits' },
      { provider: 'cli-x', id: 'hy4std', name: 'Hy4', description: 'x0.29 credits' },
      { provider: 'cli-x', id: 'glm', name: 'GLM', description: 'x0.69 credits' },
    ])
    expect(catalog.modelName('cli-x', 'glm')).toBe('GLM')
    expect(catalog.modelName('cli-x', 'default')).toBe('Hy4（默认）')
  })

  // Only distinct descriptions make a tier. Without them the row is still the alias
  // the upstream filter hides, so that de-duplication must not be loosened.
  it('still hides a same-name alias when descriptions do not tell the rows apart', async () => {
    const { catalog } = setup(() =>
      Promise.resolve({
        configId: 'model',
        current: 'default',
        options: [
          { value: 'default', name: 'Opus 5.5', description: 'x1.00 credits' },
          { value: 'opus', name: 'Opus 5.5', description: 'x1.00 credits' },
          { value: 'sonnet', name: 'Sonnet 5.5' },
        ],
      }),
    )
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x').map((model) => model.id)).toEqual(['default', 'sonnet'])
  })

  it('tells the UI when the list arrives', async () => {
    const { catalog, deps } = setup()
    catalog.ensureListed('cli-x')
    await settled()
    expect(deps.onUpdated).toHaveBeenCalledWith('cli-x')
  })

  it('asks each CLI only once', async () => {
    const { catalog, deps } = setup()
    catalog.ensureListed('cli-x')
    catalog.ensureListed('cli-x')
    await settled()
    catalog.ensureListed('cli-x')
    expect(deps.probe).toHaveBeenCalledTimes(1)
  })

  // Otherwise the menu would stay on the CLI's name until the harness restarts, even after
  // the user installs it or logs in. Requests come from people choosing it, so this cannot loop.
  it('asks again after a failure, the next time it is requested', async () => {
    const { catalog, deps } = setup()
    deps.probe.mockRejectedValueOnce(new Error('not logged in'))
    catalog.ensureListed('cli-x')
    await settled()
    catalog.ensureListed('cli-x')
    await settled()
    expect(deps.probe).toHaveBeenCalledTimes(2)
    expect(catalog.listModels('cli-x')).toHaveLength(2)
  })

  // An unhandled rejection would take the whole harness down.
  it('reports a failing listener instead of leaving a rejection unhandled', async () => {
    const { catalog, deps } = setup()
    deps.onUpdated.mockImplementation(() => {
      throw new Error('listener broke')
    })
    catalog.ensureListed('cli-x')
    await settled()
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('listener broke'))
    expect(catalog.listModels('cli-x')).toHaveLength(2)
  })

  it('shares what it knows with the sessions that need it', async () => {
    const { catalog } = setup()
    expect(catalog.known('cli-x')).toBeUndefined()
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.known('cli-x')).toEqual(LIST)
  })

  // The harness rejects a catalog with duplicate ids, which would drop the whole CLI.
  it('never produces a duplicate id', async () => {
    const { catalog } = setup(() =>
      Promise.resolve({
        configId: 'model',
        current: 'b',
        options: [
          { value: 'default', name: 'Auto' },
          { value: 'a', name: 'A' },
          { value: 'a', name: 'A again' },
          { value: 'b', name: 'B' },
        ],
      }),
    )
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x').map((model) => model.id)).toEqual(['default', 'a'])
  })

  it('shows the raw id when the active model has no listed name', async () => {
    const { catalog } = setup(() => Promise.resolve({ ...LIST, current: 'hidden' }))
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x')[0]?.name).toBe('hidden（默认）')
  })

  it('stays usable when a CLI cannot be asked', async () => {
    const { catalog, deps } = setup(() => Promise.reject(new Error('not installed')))
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x')).toEqual([{ provider: 'cli-x', id: 'default', name: 'X CLI' }])
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('not installed'))
    expect(deps.onUpdated).not.toHaveBeenCalled()
  })

  it('stays usable when a CLI lists nothing', async () => {
    const { catalog, deps } = setup(() => Promise.resolve(undefined))
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.listModels('cli-x')).toHaveLength(1)
    expect(deps.onUpdated).not.toHaveBeenCalled()
  })

  it('falls back to the route for an unknown CLI', () => {
    const { catalog, deps } = setup()
    deps.labelFor.mockReturnValue(undefined)
    expect(catalog.listModels('cli-y')[0]?.name).toBe('cli-y')
  })

  it('names models', async () => {
    const { catalog } = setup()
    expect(catalog.modelName('cli-x', 'large')).toBe('large')
    catalog.ensureListed('cli-x')
    await settled()
    expect(catalog.modelName('cli-x', 'default')).toBe('Small（默认）')
    expect(catalog.modelName('cli-x', 'large')).toBe('Large')
    expect(catalog.modelName('cli-x', 'gone')).toBe('gone')
  })

  describe('lists kept from an earlier run', () => {
    const OLD: CliModelList = { configId: 'model', current: 'old', options: [{ value: 'old', name: 'Old' }] }

    // A plugin restarted by an update or a hot reload would otherwise show an empty menu until it probes again.
    it('shows them at once and tells the UI', () => {
      const { catalog, deps } = setup()
      catalog.restore(new Map([['cli-x', OLD]]))
      expect(catalog.listModels('cli-x').map((model) => model.name)).toEqual(['Old（默认）'])
      expect(catalog.known('cli-x')).toEqual(OLD)
      expect(deps.onUpdated).toHaveBeenCalledWith('cli-x')
    })

    it('ignores CLIs that are no longer configured', () => {
      const { catalog, deps } = setup()
      deps.labelFor.mockImplementation((provider) => (provider === 'cli-x' ? 'X CLI' : undefined))
      catalog.restore(new Map([['cli-gone', OLD]]))
      expect(catalog.known('cli-gone')).toBeUndefined()
      expect(deps.onUpdated).not.toHaveBeenCalled()
    })

    // The kept list may be out of date, so choosing the CLI still asks it.
    it('still asks the CLI, and the answer replaces the kept list', async () => {
      const { catalog, deps } = setup()
      catalog.restore(new Map([['cli-x', OLD]]))
      catalog.ensureListed('cli-x')
      await settled()
      expect(deps.probe).toHaveBeenCalledTimes(1)
      expect(catalog.known('cli-x')).toEqual(LIST)
    })

    it('never replaces a fresher answer', async () => {
      const { catalog, deps } = setup()
      catalog.ensureListed('cli-x')
      await settled()
      deps.onUpdated.mockClear()
      catalog.restore(new Map([['cli-x', OLD]]))
      expect(catalog.known('cli-x')).toEqual(LIST)
      expect(deps.onUpdated).not.toHaveBeenCalled()
    })

    it('asks again after a failure even while it shows a kept list', async () => {
      const { catalog, deps } = setup()
      catalog.restore(new Map([['cli-x', OLD]]))
      deps.probe.mockRejectedValueOnce(new Error('offline'))
      catalog.ensureListed('cli-x')
      await settled()
      expect(catalog.known('cli-x')).toEqual(OLD)
      catalog.ensureListed('cli-x')
      await settled()
      expect(deps.probe).toHaveBeenCalledTimes(2)
      expect(catalog.known('cli-x')).toEqual(LIST)
    })
  })

  describe('saving', () => {
    it('saves every list it knows after each answer', async () => {
      const { catalog, deps } = setup()
      catalog.ensureListed('cli-x')
      catalog.ensureListed('cli-y')
      await settled()
      expect(deps.save).toHaveBeenLastCalledWith(
        new Map([
          ['cli-x', LIST],
          ['cli-y', LIST],
        ]),
      )
    })

    it('does not save a list it only restored', () => {
      const { catalog, deps } = setup()
      catalog.restore(new Map([['cli-x', LIST]]))
      expect(deps.save).not.toHaveBeenCalled()
    })

    it('warns when saving fails, keeping the list in memory', async () => {
      const { catalog, deps } = setup()
      deps.save.mockRejectedValueOnce(new Error('disk full'))
      catalog.ensureListed('cli-x')
      await settled()
      await settled()
      expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('disk full'))
      expect(catalog.known('cli-x')).toEqual(LIST)
    })
  })

  describe('reasoning levels', () => {
    const THINKING = {
      configId: 'thinking',
      current: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    }
    const WITH_LEVELS: CliModelList = { ...LIST, efforts: { small: THINKING } }
    const LEVELS = {
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'high', name: 'High' },
      ],
      defaultEffort: 'high',
    }

    it('offers each model the levels the CLI reported', async () => {
      const { catalog } = setup(() => Promise.resolve(WITH_LEVELS))
      catalog.ensureListed('cli-x')
      await settled()
      expect(['default', 'small', 'large'].map((model) => catalog.reasoning('cli-x', model))).toEqual([
        LEVELS,
        LEVELS,
        LEVELS,
      ])
    })

    it('offers no levels before the CLI has answered', () => {
      expect(setup().catalog.reasoning('cli-x', 'default')).toBeUndefined()
    })

    it('learns what a session reports, saving it and refreshing the menu', async () => {
      const { catalog, deps } = setup(() => Promise.resolve(WITH_LEVELS))
      catalog.ensureListed('cli-x')
      await settled()
      deps.onUpdated.mockClear()
      catalog.learnEfforts('cli-x', 'large', undefined)
      expect(catalog.reasoning('cli-x', 'large')).toBeUndefined()
      expect(deps.onUpdated).toHaveBeenCalledWith('cli-x')
      expect(deps.save).toHaveBeenLastCalledWith(
        new Map([['cli-x', { ...WITH_LEVELS, efforts: { small: THINKING, large: null } }]]),
      )
    })

    it('stays quiet when a session reports nothing new', async () => {
      const { catalog, deps } = setup(() => Promise.resolve(WITH_LEVELS))
      catalog.ensureListed('cli-x')
      await settled()
      deps.onUpdated.mockClear()
      deps.save.mockClear()
      catalog.learnEfforts('cli-x', 'small', THINKING)
      expect(deps.onUpdated).not.toHaveBeenCalled()
      expect(deps.save).not.toHaveBeenCalled()
    })

    it('ignores reports for a CLI it has no list for yet', () => {
      const { catalog, deps } = setup()
      catalog.learnEfforts('cli-x', 'small', THINKING)
      expect(catalog.known('cli-x')).toBeUndefined()
      expect(deps.onUpdated).not.toHaveBeenCalled()
    })

    // A fresh probe only sees the default model; what sessions learned about the rest still holds.
    it('keeps what was learned about other models across a new answer', async () => {
      const { catalog } = setup(() => Promise.resolve(WITH_LEVELS))
      catalog.restore(new Map([['cli-x', { ...WITH_LEVELS, efforts: { small: THINKING, large: null } }]]))
      catalog.ensureListed('cli-x')
      await settled()
      expect(catalog.known('cli-x')?.efforts).toEqual({ small: THINKING, large: null })
    })

    // A CLI update can take levels away; a saved record must not keep offering them.
    it('forgets the default model levels when a new answer has none', async () => {
      const { catalog } = setup(() => Promise.resolve(LIST))
      catalog.restore(new Map([['cli-x', { ...WITH_LEVELS, efforts: { small: THINKING, large: THINKING } }]]))
      catalog.ensureListed('cli-x')
      await settled()
      expect(catalog.known('cli-x')?.efforts).toEqual({ small: null, large: THINKING })
    })
  })
})

// Each CLI has its own set of native modes; one route's report must never become
// another's, and the ids stay exactly as the CLI wrote them.
describe('native CLI modes', () => {
  const MODES_X = {
    configId: 'permission_mode',
    current: 'acceptEdits',
    options: [{ value: 'acceptEdits', name: 'Accept edits' }],
  }
  const MODES_Y = {
    configId: 'access',
    current: 'ask',
    options: [{ value: 'ask', name: 'Ask' }],
  }
  const withModes = (provider: string): Promise<CliModelList> =>
    Promise.resolve({ ...LIST, modes: provider === 'cli-x' ? MODES_X : MODES_Y })

  it('keeps each CLI modes under its own route', async () => {
    const { catalog } = setup(withModes)
    catalog.ensureListed('cli-x')
    catalog.ensureListed('cli-y')
    await settled()
    expect(catalog.modesFor('cli-x')).toEqual(MODES_X)
    expect(catalog.modesFor('cli-y')).toEqual(MODES_Y)
    expect(catalog.modesFor('cli-z')).toBeUndefined()
  })

  it('learns a reported mode change for one route only', async () => {
    const { catalog, deps } = setup(withModes)
    catalog.ensureListed('cli-x')
    catalog.ensureListed('cli-y')
    await settled()
    deps.onUpdated.mockClear()
    const changed = { ...MODES_X, current: 'plan' }
    catalog.learnModes('cli-x', changed)
    expect(catalog.modesFor('cli-x')).toEqual(changed)
    expect(catalog.modesFor('cli-y')).toEqual(MODES_Y)
    expect(deps.onUpdated).toHaveBeenCalledWith('cli-x')
  })

  it('does not refresh the menu for an unchanged report', async () => {
    const { catalog, deps } = setup(withModes)
    catalog.ensureListed('cli-x')
    await settled()
    deps.onUpdated.mockClear()
    catalog.learnModes('cli-x', MODES_X)
    expect(deps.onUpdated).not.toHaveBeenCalled()
  })

  it('ignores a report from a CLI that has not answered yet', () => {
    const { catalog, deps } = setup(withModes)
    catalog.learnModes('cli-x', MODES_X)
    expect(catalog.modesFor('cli-x')).toBeUndefined()
    expect(deps.save).not.toHaveBeenCalled()
  })
})
