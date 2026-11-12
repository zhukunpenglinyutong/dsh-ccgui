/// <reference lib="dom" />

/**
 * The reasoning level beside the model control, for models that advertise levels. It stands
 * in for the second pane of the harness's seat, which this plugin's control replaces on CLI
 * sessions only.
 * @module dsh-ccgui/client/effort-menu
 */

import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconWarningOutlineRegular,
  Menu,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectorySelection } from './choices.ts'
import type { EffortLevel, MenuModels, MenuRow } from './menu-models.ts'
import { CHEVRON_CLASS, EFFORT_CLASS, LABEL_CLASS, TRIGGER_CLASS } from './model-menu-styles.ts'
import type { SelectModel } from './model-seat.ts'

const UNKNOWN_ERROR_LABEL = '未知错误'
/** A level the session holds that the model no longer advertises. */
const UNLISTED_LEVEL_LABEL = '推理等级'

/** What the level menu is drawn from. */
export interface EffortMenuProps {
  readonly models: MenuModels
  readonly pending: DirectorySelection | null
  readonly locked: boolean
  readonly select: SelectModel
}

interface Failure {
  /** Gives each failure a toast of its own. */
  readonly seq: number
  readonly text: string
}

function selectionFor(row: MenuRow, level: EffortLevel): DirectorySelection {
  return {
    provider: row.provider,
    model: row.model,
    ...(level.effort === undefined ? {} : { reasoningEffort: level.effort }),
  }
}

function useChooseEffort(models: MenuModels, select: SelectModel, close: () => void) {
  const [failure, setFailure] = useState<Failure | undefined>()
  const fail = (text: string): void => {
    setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text }))
  }
  const choose = (key: string): void => {
    close()
    const level = models.efforts.find((candidate) => candidate.key === key)
    if (models.current === undefined || level === undefined || level.key === models.effort?.key) return
    select(selectionFor(models.current, level)).then(
      (result) => {
        if (result.error !== undefined) fail(result.error.message ?? UNKNOWN_ERROR_LABEL)
      },
      (reason: unknown) => {
        fail(String(reason))
      },
    )
  }
  return { failure, clearFailure: () => setFailure(undefined), choose }
}

/**
 * Render the level button and its menu, or nothing for a model without levels.
 * @param props - the models, the pending selection and the host's select.
 * @returns the control.
 */
export function EffortMenu({ models, pending, locked, select }: EffortMenuProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const { failure, clearFailure, choose } = useChooseEffort(models, select, () => {
    setOpen(false)
  })
  if (models.current === undefined || models.efforts.length === 0) return null
  const label = models.effort?.name ?? UNLISTED_LEVEL_LABEL
  return (
    <span ref={rootRef} className={EFFORT_CLASS}>
      <Menu
        open={open && !locked}
        items={models.efforts.map((level) => ({ id: level.key, label: level.name }))}
        selectedId={models.effort?.key}
        onSelect={choose}
        onClose={() => {
          setOpen(false)
        }}
        side="top"
        portal
        anchor={
          <button
            type="button"
            className={TRIGGER_CLASS}
            aria-label={`推理等级，当前 ${label}`}
            aria-haspopup="menu"
            aria-expanded={open}
            title={`推理等级：${label}`}
            disabled={locked || pending !== null}
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            <span className={LABEL_CLASS}>{label}</span>
            <IconChevronDownOutlineRegular className={CHEVRON_CLASS} size={14} />
          </button>
        }
      />
      {failure !== undefined && (
        <Toast
          key={failure.seq}
          text={`切换推理等级失败：${failure.text}`}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={clearFailure}
        />
      )}
    </span>
  )
}
