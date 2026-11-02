import { useEffect, useRef } from 'npm:preact/hooks'
import { signal } from '@preact/signals'
import {
  activeFile,
  createFile,
  isDirty,
  openFile,
  rootFiles,
  srcFiles,
} from '/web/pages/workspace/workspace-state.ts'
import {
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  Plus,
} from '/web/assets/icons.tsx'
import { t } from '/web/lib/i18n.ts'

/** Icon by file type: json, markdown, test, code */
export const FileIcon = ({ path }: { path: string }) => {
  if (path.endsWith('.json')) {
    return <Braces tw='w-[15px] h-[15px] flex-none text-code-fn' />
  }
  if (path.endsWith('.md')) {
    return <FileText tw='w-[15px] h-[15px] flex-none text-content-tertiary' />
  }
  if (path.endsWith('_test.ts')) {
    return <FlaskConical tw='w-[15px] h-[15px] flex-none text-code-kw' />
  }
  return <FileCode tw='w-[15px] h-[15px] flex-none text-code-kw' />
}

const creating = signal(false)
const newName = signal('')

const FileRow = ({ path, indent }: { path: string; indent: number }) => {
  const on = path === activeFile.value
  return (
    <button
      type='button'
      onClick={() => openFile(path)}
      aria-current={on ? 'true' : undefined}
      tw={[
        'w-full flex items-center gap-[7px] h-7 pr-2 rounded-md text-[13px] cursor-pointer',
        on
          ? 'bg-accent-soft text-accent-text font-medium'
          : 'text-content-primary hover:bg-surface-hover',
      ]}
      style={{ paddingLeft: `${indent}px` }}
    >
      <FileIcon path={path} />
      <span tw='flex-1 text-left truncate'>{path.split('/').pop()}</span>
      {isDirty(path) && (
        <span
          title={t('Modification non enregistrée', 'Unsaved change')}
          aria-label={t('Modification non enregistrée', 'Unsaved change')}
          tw='w-[7px] h-[7px] flex-none rounded-full bg-content-secondary'
        />
      )}
    </button>
  )
}

const srcOpen = signal(true)

const NewFileInput = () => {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    // any click outside cancels the creation, like in VS Code
    const onDown = (e: PointerEvent) =>
      root.current?.contains(e.target as Node) || (creating.value = false)
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])
  return (
    <div ref={root} tw='flex items-center gap-1 h-7 pl-[30px] pr-1.5'>
      <FileCode tw='w-[15px] h-[15px] flex-none text-code-kw' />
      <div tw='flex-1 flex items-center h-6 px-1.5 rounded-[5px] border border-accent bg-code-bg font-mono text-[12px]'>
        <input
          ref={input}
          value={newName.value}
          placeholder={t('nom', 'name')}
          aria-label={t('Nom du nouveau fichier', 'Name of the new file')}
          onInput={(e) =>
            newName.value = e.currentTarget.value.replace(/[^\w-]/g, '')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') creating.value = false
            if (e.key !== 'Enter') return
            if (createFile(newName.value)) creating.value = false
          }}
          tw='flex-1 min-w-0 bg-transparent border-0 p-0 font-mono text-[12px] focus:outline-none'
        />
        <span tw='text-content-tertiary'>.ts</span>
      </div>
    </div>
  )
}

/** Left column of C2: no folders, no rename, no delete */
export const FileExplorer = () => (
  <aside
    aria-label={t('Fichiers', 'Files')}
    tw='w-60 flex-none border-r border-border-primary bg-surface-elevated flex flex-col'
  >
    <div tw='h-9 flex items-center justify-between pl-3.5 pr-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-content-tertiary'>
      {t('Fichiers', 'Files')}
      <button
        type='button'
        onClick={() => {
          newName.value = ''
          srcOpen.value = true // new files go to src/
          creating.value = true
        }}
        tw='inline-flex items-center gap-1 h-6 px-2 rounded-md font-main font-medium normal-case tracking-normal text-[12px] text-content-secondary hover:bg-surface-hover hover:text-content-primary cursor-pointer'
      >
        <Plus tw='w-[13px] h-[13px]' />
        {t('Nouveau fichier', 'New file')}
      </button>
    </div>
    <div tw='px-1.5 py-0.5 flex flex-col gap-px'>
      <button
        type='button'
        aria-expanded={srcOpen.value}
        onClick={() => srcOpen.value = !srcOpen.value}
        tw='w-full flex items-center gap-1.5 h-[26px] px-2 rounded-md text-[13px] text-content-secondary hover:bg-surface-hover cursor-pointer'
      >
        {srcOpen.value
          ? <ChevronDown tw='w-[13px] h-[13px]' />
          : <ChevronRight tw='w-[13px] h-[13px]' />}
        {srcOpen.value
          ? <FolderOpen tw='w-[15px] h-[15px] text-content-tertiary' />
          : <Folder tw='w-[15px] h-[15px] text-content-tertiary' />}
        src
      </button>
      {srcOpen.value && creating.value && <NewFileInput />}
      {srcOpen.value &&
        srcFiles.value.map((p) => <FileRow key={p} path={p} indent={30} />)}
      {rootFiles.value.map((p) => <FileRow key={p} path={p} indent={12} />)}
    </div>
    <span tw='flex-1' />
    <p tw='m-0 px-3.5 py-2.5 text-[11.5px] text-content-tertiary border-t border-border-primary'>
      {t(
        'Nouveaux fichiers créés dans src/, en .ts.',
        'New files are created in src/, as .ts.',
      )}
    </p>
  </aside>
)
