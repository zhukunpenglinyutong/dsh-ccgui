import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelCacheFile, parseModelCache } from '../src/model-cache.ts'
import type { CliModelList } from '../src/model-options.ts'

const LIST: CliModelList = {
  configId: 'model',
  current: 'small',
  options: [
    { value: 'small', name: 'Small' },
    { value: 'large', name: 'Large' },
  ],
}

const scratch = () => join(mkdtempSync(join(tmpdir(), 'ccgui-cache-')), 'nested', 'models.json')

describe('parseModelCache', () => {
  describe('reasoning levels', () => {
    const LEVELS = { configId: 'thinking', current: 'high', options: [{ value: 'high', name: 'High' }] }

    it('reads the levels each model reported, including models seen to have none', () => {
      const list = { ...LIST, efforts: { small: LEVELS, large: null } }
      const text = JSON.stringify({ version: 1, lists: { 'cli-x': list } })
      expect(parseModelCache(text).get('cli-x')).toEqual(list)
    })

    // Levels only add to the menu; a bad record of them must not cost the models themselves.
    it('drops malformed levels but keeps the list', () => {
      const efforts = { small: { ...LEVELS, options: [] }, large: { ...LEVELS, configId: '' }, fast: 'x', ok: LEVELS }
      const text = JSON.stringify({ version: 1, lists: { 'cli-x': { ...LIST, efforts } } })
      expect(parseModelCache(text).get('cli-x')).toEqual({ ...LIST, efforts: { ok: LEVELS } })
    })

    it('leaves levels out when the record of them is not an object', () => {
      const text = JSON.stringify({ version: 1, lists: { 'cli-x': { ...LIST, efforts: [] } } })
      expect(parseModelCache(text).get('cli-x')).toEqual(LIST)
    })
  })

  it('reads what was written', () => {
    const text = JSON.stringify({ version: 1, lists: { 'cli-x': LIST } })
    expect(parseModelCache(text)).toEqual(new Map([['cli-x', LIST]]))
  })

  it('treats a broken file as empty', () => {
    expect(parseModelCache('{not json')).toEqual(new Map())
    expect(parseModelCache('null')).toEqual(new Map())
    expect(parseModelCache('[]')).toEqual(new Map())
  })

  // A file from a future layout may mean something else by the same fields.
  it('ignores another version', () => {
    expect(parseModelCache(JSON.stringify({ version: 2, lists: { 'cli-x': LIST } }))).toEqual(new Map())
  })

  // The harness drops a whole CLI from its menus over one empty id, so nothing unchecked gets through.
  it('drops entries that are not valid model lists', () => {
    const text = JSON.stringify({
      version: 1,
      lists: {
        'cli-x': LIST,
        'cli-empty': { ...LIST, options: [] },
        'cli-no-id': { ...LIST, configId: '' },
        'cli-bad-option': { ...LIST, options: [{ value: '', name: 'Nameless' }] },
        'cli-null': null,
        'cli-no-options': { configId: 'model', current: 'a' },
      },
    })
    expect(parseModelCache(text)).toEqual(new Map([['cli-x', LIST]]))
  })

  it('keeps only the fields it knows', () => {
    const text = JSON.stringify({
      version: 1,
      lists: { 'cli-x': { ...LIST, extra: true, options: [{ value: 'a', name: 'A', more: 1 }] } },
    })
    expect(parseModelCache(text).get('cli-x')).toEqual({
      configId: 'model',
      current: 'small',
      options: [{ value: 'a', name: 'A' }],
    })
  })
})

describe('ModelCacheFile', () => {
  it('reads nothing before anything was saved', async () => {
    await expect(new ModelCacheFile(scratch()).read()).resolves.toEqual(new Map())
  })

  it('saves and reads back, creating the directory', async () => {
    const path = scratch()
    const file = new ModelCacheFile(path)
    await file.save(new Map([['cli-x', LIST]]))
    await expect(new ModelCacheFile(path).read()).resolves.toEqual(new Map([['cli-x', LIST]]))
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('keeps the cost multiplier through a save and read back', async () => {
    const path = scratch()
    const priced: CliModelList = {
      configId: 'model',
      current: 'glm',
      options: [{ value: 'glm', name: 'GLM', description: 'x0.69 credits' }],
    }
    await new ModelCacheFile(path).save(new Map([['cli-x', priced]]))
    await expect(new ModelCacheFile(path).read()).resolves.toEqual(new Map([['cli-x', priced]]))
  })

  it('reads a corrupt file as empty', async () => {
    const path = scratch()
    const file = new ModelCacheFile(path)
    await file.save(new Map())
    writeFileSync(path, 'garbage')
    await expect(file.read()).resolves.toEqual(new Map())
  })

  // Two probes can finish together; the later snapshot holds both lists and must land last.
  it('writes in the order saves were asked for, leaving no temporary files', async () => {
    const path = scratch()
    const file = new ModelCacheFile(path)
    const both = new Map([
      ['cli-x', LIST],
      ['cli-y', LIST],
    ])
    await Promise.all([file.save(new Map([['cli-x', LIST]])), file.save(both)])
    await expect(file.read()).resolves.toEqual(both)
    expect(readdirSync(join(path, '..'))).toEqual(['models.json'])
  })

  it('reports a failed write and keeps accepting saves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccgui-cache-'))
    // A regular file where the directory should be makes the write fail.
    writeFileSync(join(dir, 'blocked'), '')
    const file = new ModelCacheFile(join(dir, 'blocked', 'models.json'))
    await expect(file.save(new Map([['cli-x', LIST]]))).rejects.toThrow()
    await expect(file.save(new Map())).rejects.toThrow()
  })

  it('removes its temporary file when the final rename fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccgui-cache-'))
    // A non-empty directory at the target path cannot be replaced by a rename.
    mkdirSync(join(dir, 'models.json', 'inside'), { recursive: true })
    await expect(new ModelCacheFile(join(dir, 'models.json')).save(new Map())).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['models.json'])
  })

  it('reports a read failure other than a missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccgui-cache-'))
    // A directory at the file's path cannot be read as text.
    await expect(new ModelCacheFile(dir).read()).rejects.toThrow()
  })
})

// Modes belong to a CLI in its own ids, so a restart must not lose or rename them.
describe('native modes in the model cache', () => {
  const MODES = {
    configId: 'permission_mode',
    current: 'plan',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  }

  it('keeps the modes through a save and read back', async () => {
    const path = scratch()
    const list = { ...LIST, modes: MODES }
    await new ModelCacheFile(path).save(new Map([['cli-x', list]]))
    await expect(new ModelCacheFile(path).read()).resolves.toEqual(new Map([['cli-x', list]]))
  })

  it('drops malformed modes but keeps the model list', () => {
    const text = JSON.stringify({ version: 1, lists: { 'cli-x': { ...LIST, modes: { configId: 5 } } } })
    expect(parseModelCache(text).get('cli-x')).toEqual(LIST)
  })
})
