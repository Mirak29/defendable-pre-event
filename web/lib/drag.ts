// Pointer-capture drag helper, from tournament (pages/studio/layout-state.ts).
export const setDragEvents = (
  ref: HTMLElement,
  cursor: string,
  onMove: (e: PointerEvent) => void,
) => {
  ref.addEventListener('pointerdown', (e) => {
    ref.setPointerCapture(e.pointerId)
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
  })
  ref.addEventListener('pointermove', (e) => {
    if (!ref.hasPointerCapture(e.pointerId)) return
    onMove(e)
  })
  const release = (e: PointerEvent) => {
    if (!ref.hasPointerCapture(e.pointerId)) return
    ref.releasePointerCapture(e.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  ref.addEventListener('pointerup', release)
  ref.addEventListener('pointercancel', release)
}
