import { describe, expect, it } from 'vitest'
import { modelMarkOf } from '../../src/client/model-marks.ts'

describe('modelMarkOf', () => {
  it.each([
    // [provider, model id, display name, expected mark]
    ['cli-opencode', 'opencode/deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash（默认）', 'deepseek'],
    ['cli-opencode', 'default', 'DeepSeek-V4.1-Flash（默认）', 'deepseek'],
    ['cli-opencode', 'opencode/k3', 'K3', 'kimi'],
    ['cli-opencode', 'opencode/k3-256k', 'K3-256k', 'kimi'],
    ['cli-opencode', 'x/k2.8-preview', 'K2.8 Preview', 'kimi'],
    ['cli-opencode', 'moonshotai/kimi-k2-turbo', 'Kimi K2 Turbo', 'kimi'],
    ['cli-opencode', 'anthropic/claude-opus-5-5', 'Claude Opus 5.5', 'claude'],
    ['cli-claude', 'opus', 'Opus', 'claude'],
    ['cli-claude', 'haiku', 'Haiku 5.5', 'claude'],
    ['cli-opencode', 'openai/gpt-5.5', 'GPT-5.5', 'codex'],
    ['cli-opencode', 'openai/o4-mini', 'o4-mini', 'codex'],
    ['cli-codex', 'gpt-5-codex', 'gpt-5-codex', 'codex'],
    // Every model CodeBuddy currently reports, read from ~/.dsh/ccgui/models.json.
    ['cli-codebuddy', 'hy4free', 'Hy4', 'hunyuan'],
    ['cli-codebuddy', 'hy4std', 'Hy4', 'hunyuan'],
    ['cli-codebuddy', 'hy3', 'Hy3', 'hunyuan'],
    ['cli-codebuddy', 'hy3-x', 'Hy3', 'hunyuan'],
    ['cli-codebuddy', 'deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash', 'deepseek'],
    ['cli-codebuddy', 'glm-5.3', 'GLM-5.3', 'zhipu'],
    ['cli-codebuddy', 'glm-5.3-flash', 'GLM-5.3-Flash', 'zhipu'],
    ['cli-codebuddy', 'glm-5.2', 'GLM-5.2', 'zhipu'],
    ['cli-codebuddy', 'minimax-m3.1-flash', 'MiniMax-M3.1-Flash', 'minimax'],
    ['cli-codebuddy', 'minimax-m2.7', 'MiniMax-M2.7', 'minimax'],
    ['cli-codebuddy', 'kimi-k3.1-pro', 'Kimi-K3.1-Pro', 'kimi'],
    ['cli-codebuddy', 'kimi-k3-1', 'Kimi-K3', 'kimi'],
    ['cli-codebuddy', 'kimi-k2.8-preview', 'Kimi-K2.8-Preview', 'kimi'],
    ['cli-codebuddy', 'deepseek-v4-pro', 'DeepSeek-V4-Pro', 'deepseek'],
    ['cli-codebuddy', 'step-5-preview', 'Step-5-Preview', 'stepfun'],
    ['cli-codebuddy', 'mimo-v2.6-pro', 'Xiaomi MiMo-V2.6-Pro', 'xiaomi'],
    // The same families when another provider lists them.
    ['openrouter', 'tencent/hy4-preview', 'Hy4 preview', 'hunyuan'],
    ['openrouter', 'zhipu/glm-5.3', 'GLM 5.3', 'zhipu'],
    ['openrouter', 'stepfun/step-4', 'Step-4', 'stepfun'],
  ])('reads %s %s (%s) as %s', (provider, model, name, mark) => {
    expect(modelMarkOf({ provider, model, name })).toBe(mark)
  })

  // A placeholder must not claim a maker either, so it is a neutral glyph, not a brand.
  it('falls back to a neutral mark, never an aggregator CLI’s own logo or another brand', () => {
    expect(modelMarkOf({ provider: 'cli-codebuddy', model: 'space-bunny', name: 'Space-Bunny' })).toBe('unknown')
    expect(modelMarkOf({ provider: 'cli-opencode', model: 'big-pickle', name: 'Big Pickle' })).toBe('unknown')
    expect(modelMarkOf({ provider: 'cli-someone-elses', model: 'x1', name: 'X1' })).toBe('unknown')
  })

  it('keeps a provider’s mark when the provider really is the model’s maker', () => {
    expect(modelMarkOf({ provider: 'deepseek-official', model: 'chat', name: 'Chat' })).toBe('deepseek')
    expect(modelMarkOf({ provider: 'cli-claude', model: 'unknown-4', name: 'Unknown 4' })).toBe('claude')
    expect(modelMarkOf({ provider: 'cli-kimi', model: 'unknown-4', name: 'Unknown 4' })).toBe('kimi')
  })

  it('claims nothing for a provider it knows nothing about', () => {
    expect(modelMarkOf({ provider: 'openrouter', model: 'qwen3.8-max', name: 'Qwen3.8 Max' })).toBeUndefined()
  })

  it('does not mistake words that merely contain the vendor hints', () => {
    expect(modelMarkOf({ provider: 'openrouter', model: 'polk2', name: 'Polk2' })).toBeUndefined()
    expect(modelMarkOf({ provider: 'openrouter', model: 'pro3', name: 'Pro3' })).toBeUndefined()
    expect(modelMarkOf({ provider: 'openrouter', model: 'one-step-guide', name: 'One Step Guide' })).toBeUndefined()
  })
})
