export const makeQueue = (max: number) => {
  let slotsUsed = 0
  const pendingSlots: Array<(slot: Slot) => void> = []
  type Slot = { [Symbol.dispose](): void }
  const freeSlot = {
    [Symbol.dispose]() {
      const next = pendingSlots.shift()
      next ? next(freeSlot) : slotsUsed--
    },
  }

  const queueSlot = (resolve: (slot: Slot) => void) =>
    pendingSlots.push(resolve)
  return (): Slot | Promise<Slot> => {
    if (slotsUsed >= max) return new Promise<Slot>(queueSlot)
    slotsUsed++
    return freeSlot
  }
}
