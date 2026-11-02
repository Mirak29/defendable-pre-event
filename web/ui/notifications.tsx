import { signal } from 'npm:@preact/signals'
import { useMemo, useRef, useState } from 'npm:preact/hooks'
import type { ComponentChildren } from 'npm:preact'

import { eachFrame } from '/web/lib/signals.ts'
import { CircleCheck, Info, OctagonX, X } from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

// semantic token names from web/theme.ts
const statusColors = {
  success: 'ok',
  failure: 'err',
  info: 'content-secondary',
} as const

const statusIcons = {
  success: CircleCheck,
  failure: OctagonX,
  info: Info,
} as const

type Notification = {
  at: number
  status: keyof typeof statusColors
  icon?: typeof X
  title?: string
  description: ComponentChildren
  duration?: number
  dismissed: boolean
}

const TimeProgress = (
  { start, duration, onEnd }: {
    start: number
    duration: number
    onEnd: () => void
  },
) => {
  const { now } = eachFrame.value
  const elapsed = now - start
  const percent = 1 - Math.max(Math.min(elapsed / duration, 1), 0)
  const notEnded = useRef(true)
  if (notEnded.current && elapsed > duration) {
    notEnded.current = false
    onEnd()
  }

  return (
    <div tw='overflow-hidden bg-surface-sunken'>
      <div
        style={{ width: `${percent * 100}%` }}
        tw='h-0.5 bg-border-strong'
      />
    </div>
  )
}

type LifecycleHandler<T extends HTMLElement> = (
  elem: T,
) => ((elem: T | null) => void) | void

const useLifecyle = <T extends HTMLElement>(handler: LifecycleHandler<T>) =>
  useMemo(() => {
    let prevNode: T | null = null
    let cleanup: ReturnType<typeof handler>
    return (node: typeof prevNode) => {
      if (prevNode === node) return
      cleanup && cleanup(prevNode)
      node instanceof HTMLElement && (cleanup = handler(prevNode = node))
    }
  }, [])

const NotificationCard = (
  { notification, dismiss }: {
    notification: Notification
    dismiss: (n: Notification) => void
  },
) => {
  const duration = notification.duration ?? 4_000
  const color = statusColors[notification.status]
  const title = notification.title
  const Icon = notification.icon || statusIcons[notification.status]
  const [div, setDiv] = useState<HTMLDivElement | null>(null)
  const [inactiveSince, setInactiveSince] = useState(notification.at)

  const setRef = useLifecyle<HTMLDivElement>((div) => {
    setDiv(div)
    let elapsed = 0
    let activatedSince = 0
    const timings = { mouse: -notification.at, focus: -notification.at }
    const activate = (
      event:
        | HTMLElementEventMap['mouseenter']
        | HTMLElementEventMap['mousemove']
        | HTMLElementEventMap['focusin'],
    ) => {
      const now = Date.now()
      timings[event.type.slice(0, 5) as keyof typeof timings] = now
      inactiveSince && setInactiveSince(0)
      activatedSince || (activatedSince = now)
    }
    const desactivate = (
      event:
        | HTMLElementEventMap['mouseenter']
        | HTMLElementEventMap['mousemove']
        | HTMLElementEventMap['focusin'],
    ) => {
      const now = Date.now()
      timings[event.type.slice(0, 5) as keyof typeof timings] = -now
      if (timings.focus > 0 || timings.mouse > 0) return
      elapsed += now - activatedSince
      activatedSince = 0
      setInactiveSince(now - elapsed)
    }
    div.addEventListener('mouseenter', activate, { passive: true })
    div.addEventListener('mousemove', activate, { passive: true })
    div.addEventListener('mouseleave', desactivate, { passive: true })
    div.addEventListener('focusin', activate, { passive: true })
    div.addEventListener('focusout', desactivate, { passive: true })
    return () => {
      div.removeEventListener('mouseenter', activate)
      div.removeEventListener('mousemove', activate)
      div.removeEventListener('mouseleave', desactivate)
      div.removeEventListener('focusin', activate)
      div.removeEventListener('focusout', desactivate)
    }
  })

  const close = () => {
    const handler = () => dismiss(notification)
    if (!div) return handler()
    div.dataset.closed = '1'
    div.addEventListener('transitionend', handler)
    return () => {
      div.removeEventListener('transitionend', handler)
      handler()
    }
  }

  return (
    <div
      ref={setRef}
      tw={`
      pointer-events-auto
      w-auto max-w-[520px] overflow-hidden rounded-[10px] border
      border-border-strong bg-surface-elevated shadow-[var(--shadow-lg)]

      transition
      [data-closed]:opacity-0
      [data-closed]:translate-y-2`}
    >
      <div tw='flex items-center gap-2.5 py-2.5 pl-3.5 pr-2'>
        <Icon tw={`text-${color} h-4 w-4 flex-none`} />
        <p tw='m-0 flex-1 text-[13px] text-content-primary'>
          {title && (
            <strong tw={`font-semibold text-${color}`}>{title} ·</strong>
          )}
          {title && ' '}
          {notification.description}
        </p>
        <button
          type='button'
          onClick={close}
          tw='inline-flex rounded-md text-content-tertiary p-1 hover:bg-surface-hover hover:text-content-secondary'
        >
          <span tw='sr-only'>{t('Fermer', 'Close')}</span>
          <X tw='h-3.5 w-3.5' />
        </button>
      </div>
      {!inactiveSince ? <div tw='h-0.5' /> : (
        <TimeProgress
          start={inactiveSince}
          duration={duration}
          onEnd={close}
        />
      )}
    </div>
  )
}

const currentNotifications = signal<Notification[]>([])
const dismiss = (notification: Notification) => {
  if (notification.dismissed) return
  notification.dismissed = true
  currentNotifications.value = currentNotifications.peek()
    .filter((n) => !n.dismissed)
}

export const notify = (n: Omit<Notification, 'at' | 'dismissed'>) => {
  const now = performance.timeOrigin + performance.now()
  const notifs = currentNotifications.peek()

  const nIndex = notifs.findIndex((nt) =>
    nt.status === n.status &&
    nt.title === n.title &&
    nt.description === n.description && // what if description is a component? jsonify it?
    !nt.dismissed
  )

  if (nIndex !== -1) {
    const updatedNotifications = [...notifs]
    updatedNotifications[nIndex] = {
      ...updatedNotifications[nIndex],
      at: now, // Refresh the timestamp
    }
    currentNotifications.value = updatedNotifications
  } else {
    currentNotifications.value = [...notifs, {
      ...n,
      at: now,
      dismissed: false,
    }]
  }
}

export const Notifications = () => (
  <div
    aria-live='assertive'
    tw='pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4 z-[1000]'
  >
    {currentNotifications.value.length
      ? (
        <div tw='flex flex-col items-center gap-2'>
          {currentNotifications.value.map((n) => (
            <NotificationCard notification={n} key={n.at} dismiss={dismiss} />
          ))}
        </div>
      )
      : null}
  </div>
)
