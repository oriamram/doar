import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/format'
import { getAttachmentBytes } from '../lib/gmail'
import { toast } from '../lib/toast'
import type { Attachment } from '../types'
import { CloseIcon, DownloadIcon } from './icons'

/** Pictures up to this size show as small prints right away; bigger ones wait for a tap. */
const PREVIEW_LIMIT = 4 * 1024 * 1024

async function toBlobUrl(file: Attachment): Promise<string> {
  const bytes = await getAttachmentBytes(file)
  return URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
}

async function save(file: Attachment) {
  try {
    const url = await toBlobUrl(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  } catch {
    toast(`לא הצלחנו להוריד את ${file.filename}.`, { tone: 'error' })
  }
}

/** The file type as shown on the slip: "PDF", "DOCX"… */
function fileKind(file: Attachment): string {
  const extension = file.filename.includes('.') ? file.filename.split('.').at(-1)! : ''
  return (extension || file.mimeType.split('/')[1] || 'קובץ').slice(0, 4).toUpperCase()
}

function FileCard({ file, onView }: { file: Attachment; onView: (url: string) => void }) {
  const isImage = file.mimeType.startsWith('image/')
  const [thumb, setThumb] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Pictures show as small photo prints.
  useEffect(() => {
    if (!isImage || file.size > PREVIEW_LIMIT) return
    let cancelled = false
    let url: string | undefined
    toBlobUrl(file).then(
      (created) => {
        url = created
        if (cancelled) URL.revokeObjectURL(created)
        else setThumb(created)
      },
      () => {},
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, isImage])

  const open = async () => {
    if (thumb) {
      onView(thumb)
      return
    }
    setBusy(true)
    await save(file)
    setBusy(false)
  }

  if (thumb) {
    return (
      <button className="photo" onClick={open} title={file.filename} aria-label={`תמונה: ${file.filename}`}>
        <img src={thumb} alt="" />
        <span className="photo-name ellipsis" dir="auto">
          {file.filename}
        </span>
      </button>
    )
  }
  return (
    <button className="file-slip" onClick={open} disabled={busy} title={`הורדת ${file.filename}`}>
      <span className="file-kind">{fileKind(file)}</span>
      <span className="file-text">
        <span className="file-name ellipsis" dir="auto">
          {file.filename}
        </span>
        <span className="file-size">{busy ? 'מורידים…' : formatBytes(file.size)}</span>
      </span>
      <DownloadIcon />
    </button>
  )
}

/** Files attached to an email: photos as prints, everything else as paper slips. */
export function Attachments({ files }: { files: Attachment[] }) {
  const [viewing, setViewing] = useState<{ url: string; file: Attachment } | null>(null)

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  if (files.length === 0) return null
  return (
    <div className="attachments" aria-label="קבצים מצורפים">
      {files.map((file) => (
        <FileCard key={file.key} file={file} onView={(url) => setViewing({ url, file })} />
      ))}

      {viewing && (
        <div className="lightbox" role="dialog" aria-label={viewing.file.filename}>
          <button className="lightbox-backdrop" aria-label="סגירה" onClick={() => setViewing(null)} />
          <img src={viewing.url} alt={viewing.file.filename} />
          <div className="lightbox-bar">
            <button className="icon-btn" onClick={() => void save(viewing.file)} aria-label="הורדה" title="הורדה">
              <DownloadIcon />
            </button>
            <button className="icon-btn" onClick={() => setViewing(null)} aria-label="סגירה" title="סגירה">
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
