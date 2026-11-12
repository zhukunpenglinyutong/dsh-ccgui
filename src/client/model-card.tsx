/// <reference lib="dom" />

/**
 * The open model menu: the search field, the rows under their providers' headings and the
 * card around them.
 * @module dsh-ccgui/client/model-card
 */

import type { CSSProperties, ReactElement, RefObject } from 'react'
import { IconCheckOutlineRegular, Input, MenuSurface, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { compactDescription } from '../constants.ts'
import type { DirectorySelection } from './choices.ts'
import { MarkGlyph } from './marks.tsx'
import { isRow, rowCount } from './menu-models.ts'
import type { MenuModels, MenuRow, MenuSection } from './menu-models.ts'
import { modelMarkOf } from './model-marks.ts'
import {
  HEADING_CLASS,
  HINT_CLASS,
  MENU_CLASS,
  ROW_ACTIVE_CLASS,
  ROW_CHECK_CLASS,
  ROW_CLASS,
  ROW_MARK_CLASS,
  ROW_DESCRIPTION_CLASS,
  ROW_NAME_CLASS,
  ROWS_CLASS,
  SEARCH_CLASS,
  SEARCH_INPUT_CLASS,
} from './model-menu-styles.ts'

/** The harness's seat offers search from the same size, so the two menus agree. */
export const SEARCH_ABOVE = 4
const MENU_LABEL = '模型'
const SEARCH_LABEL = '搜索模型…'
const NO_MATCH_LABEL = '没有匹配的模型。'
const NO_MODELS_LABEL = '暂无可用模型'
const ROW_MARK_SIZE = 14

interface ModelRowProps {
  readonly domId: string
  readonly model: MenuRow
  readonly selected: boolean
  readonly settling: boolean
  readonly active: boolean
  readonly busy: boolean
  readonly onHover: () => void
  readonly onChoose: () => void
}

function ModelRow({ domId, model, selected, settling, active, busy, onHover, onChoose }: ModelRowProps): ReactElement {
  const check = selected ? <IconCheckOutlineRegular /> : null
  const mark = modelMarkOf(model)
  // Prose would crowd the row and push the check mark aside; see compactDescription.
  const detail = compactDescription(model.description)
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      id={domId}
      tabIndex={-1}
      title={model.name}
      className={active ? `${ROW_CLASS} ${ROW_ACTIVE_CLASS}` : ROW_CLASS}
      disabled={busy}
      onMouseMove={active || busy ? undefined : onHover}
      onClick={onChoose}
    >
      {/* The slot stays when there is no mark, so every name starts at the same place. */}
      <span className={ROW_MARK_CLASS}>{mark === undefined ? null : <MarkGlyph id={mark} size={ROW_MARK_SIZE} />}</span>
      <span className={ROW_NAME_CLASS}>{model.name}</span>
      {detail !== undefined && (
        <span className={ROW_DESCRIPTION_CLASS} title={detail}>
          {detail}
        </span>
      )}
      <span className={ROW_CHECK_CLASS}>{settling ? <StateDot state="ongoing" /> : check}</span>
    </button>
  )
}

export interface ModelCardProps {
  readonly id: string
  readonly models: MenuModels
  /** The sections left after search. */
  readonly sections: readonly MenuSection[]
  readonly active: number
  readonly pending: DirectorySelection | null
  readonly query: string
  readonly anchorStyle: CSSProperties
  readonly cardRef: RefObject<HTMLDivElement>
  readonly searchRef: RefObject<HTMLInputElement>
  readonly onQuery: (query: string) => void
  readonly onHighlight: (index: number) => void
  readonly onChoose: (row: MenuRow) => void
}

interface ModelSearchProps {
  readonly id: string
  readonly active: number
  readonly query: string
  readonly busy: boolean
  readonly searchRef: RefObject<HTMLInputElement>
  readonly onQuery: (query: string) => void
}

function ModelSearch({ id, active, query, busy, searchRef, onQuery }: ModelSearchProps): ReactElement {
  return (
    <div className={SEARCH_CLASS}>
      <Input
        ref={searchRef}
        className={SEARCH_INPUT_CLASS}
        type="text"
        role="searchbox"
        aria-label={SEARCH_LABEL}
        aria-controls={`${id}-rows`}
        aria-activedescendant={active < 0 ? undefined : `${id}-model-${active}`}
        placeholder={SEARCH_LABEL}
        value={query}
        readOnly={busy}
        onChange={(event) => {
          onQuery(event.target.value)
        }}
      />
    </div>
  )
}

type ModelRowsProps = Pick<
  ModelCardProps,
  'id' | 'models' | 'sections' | 'active' | 'pending' | 'onHighlight' | 'onChoose'
>

/** Indexes run across the sections, so the highlight and the arrows ignore the headings. */
function ModelRows({ id, models, sections, active, pending, onHighlight, onChoose }: ModelRowsProps): ReactElement {
  const starts = sections.map((_section, index) => rowCount(sections.slice(0, index)))
  return (
    <div id={`${id}-rows`} className={`${ROWS_CLASS} scrollable`} role="menu" aria-label={MENU_LABEL}>
      {sections.map((section, sectionIndex) => (
        <div key={section.id} role="none">
          {section.headed && (
            <div className={HEADING_CLASS} role="presentation">
              {section.name}
            </div>
          )}
          {section.rows.map((row, rowIndex) => {
            const index = (starts[sectionIndex] ?? 0) + rowIndex
            return (
              <ModelRow
                key={`${row.provider}/${row.model}`}
                domId={`${id}-model-${index}`}
                model={row}
                selected={isRow(row, models.current)}
                settling={isRow(row, pending)}
                active={index === active}
                busy={pending !== null}
                onHover={() => {
                  onHighlight(index)
                }}
                onChoose={() => {
                  onChoose(row)
                }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function emptyLabel(models: MenuModels): string {
  return rowCount(models.sections) === 0 ? NO_MODELS_LABEL : NO_MATCH_LABEL
}

/**
 * Render the open menu.
 * @param props - the rows to show and what to do with them.
 * @returns the menu surface.
 */
export function ModelCard(props: ModelCardProps): ReactElement {
  const {
    id,
    models,
    sections,
    active,
    pending,
    query,
    anchorStyle,
    cardRef,
    searchRef,
    onQuery,
    onHighlight,
    onChoose,
  } = props
  const busy = pending !== null
  return (
    <MenuSurface
      ref={cardRef}
      id={`${id}-menu`}
      className={MENU_CLASS}
      style={anchorStyle}
      role="group"
      aria-label={models.label}
    >
      {rowCount(models.sections) > SEARCH_ABOVE && (
        <ModelSearch id={id} active={active} query={query} busy={busy} searchRef={searchRef} onQuery={onQuery} />
      )}
      <ModelRows {...{ id, models, sections, active, pending, onHighlight, onChoose }} />
      {sections.length === 0 && (
        <div className={HINT_CLASS} role="status">
          {emptyLabel(models)}
        </div>
      )}
      {models.unlisted !== undefined && (
        <div className={HINT_CLASS} role="status">{`还没有读到 ${models.unlisted} 的模型列表`}</div>
      )}
    </MenuSurface>
  )
}
