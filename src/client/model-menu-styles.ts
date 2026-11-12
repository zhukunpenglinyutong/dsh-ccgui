/**
 * Class names and styles of the composer's model menu. Metrics and colors follow the
 * harness's own model seat, so the two read as one control.
 * @module dsh-ccgui/client/model-menu-styles
 */

import { CLI_ROUTE_PREFIX } from '../constants.ts'

export const ROOT_CLASS = 'dsh-cli-model'
export const TRIGGER_CLASS = 'dsh-cli-model-trigger'
export const ICON_CLASS = 'dsh-cli-model-icon'
export const LABEL_CLASS = 'dsh-cli-model-label'
export const CHEVRON_CLASS = 'dsh-cli-model-chevron'
export const MENU_CLASS = 'dsh-cli-model-menu'
export const SEARCH_CLASS = 'dsh-cli-model-search'
export const SEARCH_INPUT_CLASS = 'dsh-cli-model-search-input'
export const ROWS_CLASS = 'dsh-cli-model-rows'
export const ROW_CLASS = 'dsh-cli-model-row'
export const ROW_ACTIVE_CLASS = 'dsh-cli-model-row-active'
export const ROW_MARK_CLASS = 'dsh-cli-model-row-mark'
export const ROW_NAME_CLASS = 'dsh-cli-model-row-name'
export const ROW_DESCRIPTION_CLASS = 'dsh-cli-model-row-description'
export const ROW_CHECK_CLASS = 'dsh-cli-model-row-check'
export const HINT_CLASS = 'dsh-cli-model-hint'
export const HEADING_CLASS = 'dsh-cli-model-heading'
export const GROUP_CLASS = 'dsh-cli-model-group'
export const EFFORT_CLASS = 'dsh-cli-model-effort'
export const MODE_CLASS = 'dsh-cli-model-mode'
/** The CLI's mode control, sitting in the composer's permission seat. */
export const MODE_SEAT_CLASS = 'dsh-cli-mode-seat'

// On a CLI session the first rule hides the harness's seat, which renders right after this
// control's slot; the anchors set `display: contents` inline, hence `!important`. A harness
// session renders no .dsh-cli-model, so its own seat stays together with the settings that
// live in its menu, such as the agent-team toggle. If the harness changes its markup both
// controls show, and either still works.
//
// That native seat reads one global catalog, so it also lists every CLI even though a session
// the harness runs cannot move to one. The next rule hides just those groups, keyed by the
// provider id the harness puts on every model row (cli-..., the same prefix the routes use).
// Its own providers (deepseek-account, deepseek-official) and the settings in the menu are
// left alone. The plugin's own menu uses div[role="none"] rows with no provider id and its
// rows live under .dsh-cli-model-rows, so neither is matched. If the harness drops the
// attribute the groups simply show again; nothing else breaks.
export const MODEL_MENU_STYLES = `
[role="menu"][aria-label="模型"]:not(.${ROWS_CLASS}) section[data-menu-group]:has([data-provider-id^="${CLI_ROUTE_PREFIX}"]) { display: none !important; }
[data-slot="conversation.input.right"]:has(.${ROOT_CLASS}) + [data-slot="conversation.input.model"] { display: none !important; }
.${ROOT_CLASS} { position: relative; min-width: 0; }
.${TRIGGER_CLASS} {
  anchor-name: var(--dsh-cli-model-anchor);
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 360px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  cursor: pointer;
}
.${TRIGGER_CLASS}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${TRIGGER_CLASS}:focus-visible:not([data-selection-focus]) {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.${TRIGGER_CLASS}:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.${ICON_CLASS} { display: var(--dsh-composer-model-icon-display, none); flex: 0 0 auto; }
.${LABEL_CLASS} {
  display: var(--dsh-composer-model-text-display, block);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CHEVRON_CLASS} { flex: 0 0 auto; color: var(--dsw-alias-label-caption); transition: transform 120ms ease; }
.${TRIGGER_CLASS}[aria-expanded="true"] .${CHEVRON_CLASS} { transform: rotate(180deg); }
.${MENU_CLASS} {
  box-sizing: border-box;
  position: fixed;
  position-anchor: var(--dsh-cli-model-anchor);
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  left: 12px;
  right: anchor(right);
  bottom: calc(anchor(top) + 8px);
  align-self: safe end;
  justify-self: safe end;
  margin: 0;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  width: fit-content;
  height: fit-content;
  min-width: min(240px, calc(100vw - 24px));
  max-width: min(420px, calc(100vw - 24px));
  max-height: min(360px, calc(100dvh - 96px));
  overflow: hidden;
  padding: 4px;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.${SEARCH_CLASS} { flex-shrink: 0; margin: 2px 0 3px; }
.${SEARCH_CLASS} .${SEARCH_INPUT_CLASS} {
  display: flex;
  height: auto;
  padding: 5px 7px;
  border: 0 solid transparent;
  border-radius: var(--dsw-radius-md);
  background: transparent;
}
.${SEARCH_CLASS} .${SEARCH_INPUT_CLASS}:focus-within { border-color: transparent; }
.${SEARCH_CLASS} .${SEARCH_INPUT_CLASS} input { padding: 0; font-size: 12px; line-height: normal; }
.${SEARCH_CLASS} .${SEARCH_INPUT_CLASS} input::placeholder { color: var(--dsw-alias-label-caption); }
@media (pointer: coarse) {
  .${SEARCH_CLASS} .${SEARCH_INPUT_CLASS} input { font-size: 16px; }
}
.${ROWS_CLASS} { min-height: 0; overflow-x: hidden; overflow-y: auto; }
.${ROW_CLASS} {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 5px 7px;
  border: none;
  border-radius: var(--dsw-radius-md);
  outline: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.${ROW_ACTIVE_CLASS}:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${ROW_CLASS}:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; pointer-events: none; }
.${ROW_MARK_CLASS} { display: grid; place-items: center; flex: 0 0 14px; }
.${ROW_NAME_CLASS} {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${ROW_DESCRIPTION_CLASS} {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${ROW_CHECK_CLASS} { display: grid; place-items: center; flex: 0 0 14px; color: var(--dsw-alias-label-primary); }
.${ROW_CHECK_CLASS} svg { width: 14px; height: 14px; }
.${HEADING_CLASS} {
  padding: 6px 7px 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.${GROUP_CLASS} { display: flex; align-items: center; min-width: 0; }
/* Where the composer is too narrow for the model's name, the level gives way as well. */
.${EFFORT_CLASS} { display: var(--dsh-composer-model-text-display, block); flex: 0 0 auto; }
.${EFFORT_CLASS} .${TRIGGER_CLASS} { padding: 0 4px; color: var(--dsw-alias-label-caption); }
/* The CLI's own mode sits beside the level, read the same way so neither outranks the name. */
.${MODE_CLASS} { display: var(--dsh-composer-model-text-display, block); flex: 0 0 auto; }
.${MODE_CLASS} .${TRIGGER_CLASS} { padding: 0 4px; color: var(--dsw-alias-label-caption); }
/* The permission seat holds one control: on a CLI session that is the CLI's own mode, so
   the harness's access control steps aside. It keys on the mode control itself, not its seat:
   a CLI that reports no modes leaves the seat empty, and the access control must then stay. */
.${MODE_SEAT_CLASS} { display: inline-flex; min-width: 0; }
.${MODE_SEAT_CLASS} .${TRIGGER_CLASS} { padding: 0 4px 0 8px; color: var(--dsw-alias-label-secondary); }
[data-composer-card]:has(.${MODE_CLASS}) [aria-label^="访问模式"] { display: none !important; }
.${HINT_CLASS} { padding: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
`
