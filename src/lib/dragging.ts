// Dragging letters with a mouse onto a folder, a label or the bin (PC).

/** The name under which the dragged letters' ids travel. */
export const DRAG_TYPE = 'application/x-doar-letters'

/** True on a device with a mouse: letters can be dragged there (a finger swipes instead). */
export const canDrag = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

type Carrier = { dataTransfer: DataTransfer | null }

export const carriesLetters = (event: Carrier) => !!event.dataTransfer?.types.includes(DRAG_TYPE)

/** The ids of the letters being dropped. */
export function droppedLetters(event: Carrier): string[] {
  try {
    const ids: unknown = JSON.parse(event.dataTransfer?.getData(DRAG_TYPE) || '[]')
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}
