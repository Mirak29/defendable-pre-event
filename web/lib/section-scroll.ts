import { useEffect } from 'preact/hooks'
import { navigate, url } from '/web/lib/router-signal.ts'
import { paths } from '/web/paths.ts'

// Each section of the landing has its own clean URL (/faq, not /#faq): a
// click or the back button scrolls to it, and scrolling the page keeps the
// address bar on the section being read.

/** id of the section element → its path, in page order */
export const landingSections = [
  ['principe', paths.principle],
  ['comment', paths.how],
  ['candidats', paths.forCandidates],
  ['faq', paths.faq],
] as const

export const landingPaths: string[] = [
  paths.home,
  ...landingSections.map(([, path]) => path),
]

const idOf = (path: string) => landingSections.find(([, p]) => p === path)?.[0]

// a section counts as read once its top passes this line (below the header)
const OFFSET = 120

/** the path set by this module: the landing must not scroll again for it */
let synced: string | undefined
/** a scroll we started: the reading position must not change the URL */
let pinned = false
let unpin: ReturnType<typeof setTimeout> | undefined
// released by `scrollend`, by the reader (wheel, touch, keys) or at the
// latest after this delay (no `scrollend` when nothing had to move)
const PIN_MS = 1200
const pin = () => {
  pinned = true
  clearTimeout(unpin)
  unpin = setTimeout(() => pinned = false, PIN_MS)
}

const scrollToPath = (path: string) => {
  const id = idOf(path)
  const section = id && document.getElementById(id)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior = reduce ? 'auto' : 'smooth'
  pin()
  if (!section) return scrollTo({ top: 0, behavior })
  section.scrollIntoView({ behavior })
  // like a native anchor: keyboard navigation goes on from the section
  section.focus({ preventScroll: true })
}

/** Click on a section link: modified clicks keep the browser behaviour */
export const onSectionClick = (path: string, then?: () => void) =>
(
  e: MouseEvent,
) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return
  }
  e.preventDefault()
  then?.()
  navigate({ href: path })
}

/** section being read, from the scroll position */
const readPath = () => {
  if (innerHeight + scrollY >= document.body.scrollHeight - 2) {
    return landingSections.at(-1)![1]
  }
  let current: string = paths.home
  for (const [id, path] of landingSections) {
    const top = document.getElementById(id)?.getBoundingClientRect().top
    if (top !== undefined && top <= OFFSET) current = path
  }
  return current
}

/** On the landing: URL → scroll (links, back button, direct load) and back */
export const useSectionUrl = () => {
  // an old `/#faq` link becomes `/faq`
  useEffect(() => {
    const path = landingSections.find(([id]) =>
      `#${id}` === decodeURIComponent(location.hash)
    )?.[1]
    if (path) navigate({ href: path, replace: true })
  }, [])

  useEffect(() => {
    if (url.path === synced) return
    synced = url.path
    scrollToPath(url.path)
  }, [url.path])

  useEffect(() => {
    const update = () => {
      if (pinned) return
      const path = readPath()
      if (path === url.path) return
      synced = path
      navigate({ href: path, replace: true })
    }
    // the reader takes over again: scroll ended, or wheel, touch, keys
    const release = () => pinned = false
    const events = ['scrollend', 'wheel', 'touchmove', 'keydown']
    addEventListener('scroll', update, { passive: true })
    for (const type of events) {
      addEventListener(type, release, { passive: true })
    }
    return () => {
      synced = undefined
      pinned = false
      clearTimeout(unpin)
      removeEventListener('scroll', update)
      for (const type of events) removeEventListener(type, release)
    }
  }, [])
}
