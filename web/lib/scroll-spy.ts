import { useEffect, useState } from 'npm:preact/hooks'

// a section is "current" once its top passes below the sticky top bar
const OFFSET = 96
const ANCHOR_EVENT = 'dfd-anchor'

/** Called by AnchorLink: the clicked section wins over the scroll position */
export const announceAnchor = (id: string) =>
  dispatchEvent(new CustomEvent(ANCHOR_EVENT, { detail: id }))

/**
 * Id of the section being read, for the anchor menus of R4 and R6.
 * The last section whose top is above the offset wins; at the very bottom of
 * the page the last section is current even if it is short. After a click in
 * the menu, the clicked section stays current until the user scrolls by
 * himself (short sections at the end of the page cannot reach the top).
 */
export const useActiveSection = (ids: readonly string[]) => {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    let pinned = false
    const update = () => {
      if (pinned) return
      const bottom = innerHeight + scrollY >= document.body.scrollHeight - 2
      if (bottom) return setActive(ids.at(-1)!)
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= OFFSET) current = id
      }
      setActive(current)
    }
    const onAnchor = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (!ids.includes(id)) return
      pinned = true
      setActive(id)
    }
    const release = () => pinned = false
    update()
    addEventListener('scroll', update, { passive: true })
    addEventListener('resize', update, { passive: true })
    addEventListener(ANCHOR_EVENT, onAnchor)
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      addEventListener(type, release, { passive: true })
    }
    return () => {
      removeEventListener('scroll', update)
      removeEventListener('resize', update)
      removeEventListener(ANCHOR_EVENT, onAnchor)
      for (const type of ['wheel', 'touchmove', 'keydown']) {
        removeEventListener(type, release)
      }
    }
  }, [ids.join()])
  return active
}
