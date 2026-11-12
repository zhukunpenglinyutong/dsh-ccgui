// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The harness's own model seat lists every provider in one global catalog. A session the
 * harness runs cannot move to a CLI, so a style rule hides just those groups: the harness's
 * own providers, the settings in that menu and the plugin's own menu must all stay visible.
 * @module dsh-ccgui/tests/client/model-menu-styles
 */

import { describe, expect, it } from 'vitest'
import { CLI_ROUTE_PREFIX } from '../../src/constants.ts'
import { MODE_CLASS, MODE_SEAT_CLASS, MODEL_MENU_STYLES, ROWS_CLASS } from '../../src/client/model-menu-styles.ts'

const HARNESS_MENU = `
<div id="harness" role="menu" aria-label="模型">
  <section data-menu-group id="harness-provider">
    <div data-menu-group-heading>DeepSeek 账号</div>
    <button type="button" role="menuitemradio">
      <span data-provider-id="deepseek-account" data-model-id="v4-flash">DeepSeek-V4.1-Flash</span>
    </button>
  </section>
  <section data-menu-group id="cli-provider">
    <div data-menu-group-heading>Claude Code</div>
    <button type="button" role="menuitemradio">
      <span data-provider-id="${CLI_ROUTE_PREFIX}claude" data-model-id="default">Claude Code</span>
    </button>
  </section>
  <section data-menu-group id="harness-setting">
    <div data-menu-group-heading>智能体团队</div>
    <button type="button" role="menuitemradio">启用智能体团队协作</button>
  </section>
</div>
<div id="plugin" class="${ROWS_CLASS}" role="menu" aria-label="模型">
  <div role="none">
    <button type="button" role="menuitemradio">${CLI_ROUTE_PREFIX}codebuddy 的模型</button>
  </div>
</div>
`

function installStyles(): void {
  document.head.innerHTML = `<style>${MODEL_MENU_STYLES}</style>`
  document.body.innerHTML = HARNESS_MENU
}

const displayOf = (id: string): string => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`missing ${id}`)
  return getComputedStyle(node).display
}

describe('the harness model seat on a non-CLI session', () => {
  it('hides a group whose row names a CLI provider', () => {
    installStyles()
    expect(displayOf('cli-provider')).toBe('none')
  })

  it.each(['harness-provider', 'harness-setting'])('keeps %s visible', (id) => {
    installStyles()
    expect(displayOf(id)).not.toBe('none')
  })

  it("keeps the plugin's own menu visible", () => {
    installStyles()
    expect(displayOf('plugin')).not.toBe('none')
  })
})

// The access control only steps aside for a mode control that is really there: a CLI that
// reports no modes leaves its seat empty, and the harness's control must stay usable.
describe('the access control on a CLI session', () => {
  const composer = (seat: string): void => {
    document.head.innerHTML = `<style>${MODEL_MENU_STYLES}</style>`
    document.body.innerHTML = `
<div data-composer-card>
  <span class="${MODE_SEAT_CLASS}">${seat}</span>
  <button id="access" type="button" aria-label="访问模式：完全权限">完全权限</button>
</div>`
  }

  it('stays when the CLI reports no modes', () => {
    composer('')
    expect(displayOf('access')).not.toBe('none')
  })

  it("steps aside for the CLI's mode control", () => {
    composer(`<span class="${MODE_CLASS}"><button type="button">Plan</button></span>`)
    expect(displayOf('access')).toBe('none')
  })
})
