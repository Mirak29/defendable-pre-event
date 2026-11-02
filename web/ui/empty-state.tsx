import type { ComponentChildren } from 'npm:preact'
import { FileSearch } from '/web/assets/icons.tsx'

export function EmptyState(
  { title, description, children }: {
    title: string
    description?: string
    children?: ComponentChildren
  },
) {
  return (
    <div tw='flex flex-col items-center justify-center gap-2 px-8 py-12 text-center card-sunken'>
      <FileSearch tw='w-8 h-8 text-content-tertiary mb-2' />
      <h3 tw='m-0 text-[15px] font-semibold text-content-primary'>{title}</h3>
      {description && (
        <p tw='m-0 text-content-secondary text-[13.5px] max-w-[420px]'>
          {description}
        </p>
      )}
      {children && <div tw='mt-3'>{children}</div>}
    </div>
  )
}
