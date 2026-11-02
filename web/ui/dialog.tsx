import type { JSX, VNode } from 'npm:preact'
import type { Token } from 'npm:@twind/preact'
import { useState } from 'npm:preact/hooks'
import { navigate, url } from '/web/lib/router-signal.ts'
import { Button, type ButtonVariant } from '/web/ui/button.tsx'
import { X } from '/web/assets/icons.tsx'

type DialogProps = {
  id: string
  tw?: Token
  children: preact.ComponentChildren
  /** false: no close button, no Escape, no backdrop click (e.g. time is up) */
  closable?: boolean
  /** extra URL params cleared with `dialog` when closing (e.g. file, lines) */
  closeParams?: string[]
} & JSX.HTMLAttributes<HTMLDialogElement>

/** Native <dialog>, opened when `?dialog=<id>` is in the URL (like tournament) */
export const Dialog = ({
  id,
  tw,
  children,
  closable = true,
  closeParams = [],
  onPointerDown,
  onClose,
  ...props
}: DialogProps) => {
  const [dialogElem, setRef] = useState<HTMLDialogElement | null>(null)

  const isOpen = url.params.dialog === id
  if (dialogElem) {
    if (!isOpen && dialogElem.open) {
      dialogElem.close()
    } else if (isOpen && !dialogElem.open) {
      dialogElem.showModal()
    }
  }

  return (
    <dialog
      {...props}
      tw={['z-50 bg-transparent p-0', tw]}
      onPointerDown={(event) => {
        closable && dialogElem === event.target && dialogElem?.close()
        typeof onPointerDown === 'function' && onPointerDown(event)
      }}
      onCancel={(event) => closable || event.preventDefault()}
      onClose={(event) => {
        typeof onClose === 'function' && onClose(event)
        if (!isOpen) return
        navigate({ params: closingParams(closeParams) })
      }}
      ref={setRef}
    >
      {isOpen ? children : null}
    </dialog>
  )
}

export const closingParams = (keys: string[] = []) =>
  Object.fromEntries(['dialog', ...keys].map((k) => [k, null]))

export const CloseButton = (
  { dataTest, closeParams }: { dataTest: string; closeParams?: string[] },
) => (
  <Button
    variant='ghost'
    size='icon'
    params={closingParams(closeParams)}
    aria-label='Fermer'
    title='Fermer'
    data-test={dataTest}
  >
    <X tw='w-4 h-4' />
  </Button>
)

export const ModalDialog = (
  {
    children,
    tw,
    id,
    heading,
    bare,
    closable = true,
    trigger,
    triggerTw,
    triggerVariant,
    'data-test': dataTest,
    onClose,
  }:
    & DialogProps
    & {
      heading?: preact.ComponentChildren
      /** no padding, no title row: the children lay out the whole modal */
      bare?: boolean
      trigger?: VNode<unknown> | string
      triggerTw?: Token
      triggerVariant?: ButtonVariant
      'data-test'?: string
    },
) => (
  <>
    {trigger && (
      <Button
        variant={triggerVariant}
        tw={[triggerTw]}
        params={{ dialog: id }}
        data-test={dataTest}
      >
        {trigger}
      </Button>
    )}
    <Dialog id={id} data-variant='modal' closable={closable} onClose={onClose}>
      <div
        tw={[
          'relative rounded-xl border border-border-primary bg-surface-elevated text-content-primary shadow-[var(--shadow-lg)] w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto',
          !bare && 'p-5 sm:p-6 flex flex-col gap-4',
          tw,
        ]}
      >
        {!bare && (heading || closable) && (
          <div tw='flex items-start gap-3'>
            {heading && (
              <h2 tw='m-0 flex-1 text-[17px] font-semibold leading-snug'>
                {heading}
              </h2>
            )}
            {closable && (
              <span tw='ml-auto -mt-1 -mr-2'>
                <CloseButton dataTest='dialog-close-btn' />
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </Dialog>
  </>
)

export const DrawerDialog = (
  {
    children,
    tw,
    id,
    trigger,
    triggerTw,
    'data-test': dataTest,
    position = 'right',
    width = 'w-80',
    closeParams,
    heading,
  }:
    & DialogProps
    & {
      position?: 'right' | 'left'
      width?: string
      heading?: preact.ComponentChildren
      trigger?: VNode<unknown> | string
      triggerTw?: Token
      'data-test'?: string
    },
) => (
  <>
    {trigger && (
      <Button
        variant='secondary'
        tw={triggerTw}
        params={{ dialog: id }}
        data-test={dataTest}
      >
        {trigger}
      </Button>
    )}
    <Dialog id={id} data-variant='drawer' closeParams={closeParams}>
      <div
        tw={[
          `fixed top-0 ${position}-0 border-${position[0]}`,
          width,
          'h-full max-w-[100vw] bg-surface-elevated shadow-[var(--shadow-lg)] border-border-primary text-content-primary z-50 flex flex-col',
          tw,
        ]}
      >
        <div tw='h-[52px] flex-none flex items-center gap-2.5 pl-[18px] pr-3 border-b border-border-primary bg-surface-elevated'>
          {heading && (
            <div tw='flex-1 min-w-0 flex items-center gap-2.5'>{heading}</div>
          )}
          <span tw='ml-auto'>
            <CloseButton
              dataTest='drawer-close-btn'
              closeParams={closeParams}
            />
          </span>
        </div>

        <div tw='flex-1 min-h-0 overflow-y-auto'>
          {children}
        </div>
      </div>
    </Dialog>
  </>
)
