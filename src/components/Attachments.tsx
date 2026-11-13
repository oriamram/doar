import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatBytes } from '../lib/format'
import { getAttachmentBytes } from '../lib/gmail'
import { toast } from '../lib/toast'
import type { Attachment } from '../types'
import { CloseIcon, DownloadIcon } from './icons'

/** Pictures up to this size show as small prints right away; bigger ones wait for a tap. */
const PREVIEW_LIMIT = 4 * 1024 * 1024

async function toBlobUrl(file: Attachment, type = file.mimeType): Promise<string> {
  const bytes = await getAttachmentBytes(file)
  return URL.createObjectURL(new Blob([bytes], { type }))
}

const isPdf = (file: Attachment) => file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.filename)

/** Can this browser show a PDF inside the page? (Desktop browsers can; phones hand it to another app.) */
const showsPdf = () => (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true

type Viewing = { url: string; file: Attachment; kind: 'image' | 'pdf' }

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

function FileCard({ file, onView }: { file: Attachment; onView: (url: string, kind: Viewing['kind']) => void }) {
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

  const readable = isPdf(file) && showsPdf()
  const open = async () => {
    if (thumb) {
      onView(thumb, 'image')
      return
    }
    setBusy(true)
    if (readable) {
      try {
        onView(await toBlobUrl(file, 'application/pdf'), 'pdf')
      } catch {
        toast(`לא הצלחנו לפתוח את ${file.filename}.`, { tone: 'error' })
      }
    } else await save(file)
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
    <button className="file-slip" onClick={open} disabled={busy} title={`${readable ? 'פתיחת' : 'הורדת'} ${file.filename}`}>
      <span className="file-kind">{fileKind(file)}</span>
      <span className="file-text">
        <span className="file-name ellipsis" dir="auto">
          {file.filename}
        </span>
        <span className="file-size" dir={busy ? undefined : 'ltr'}>
          {busy ? 'מורידים…' : formatBytes(file.size)}
        </span>
      </span>
      <DownloadIcon />
    </button>
  )
}

/** Files attached to an email: photos as prints, everything else as paper slips. */
export function Attachments({ files }: { files: Attachment[] }) {
  const [viewing, setViewing] = useState<Viewing | null>(null)

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // A document was fetched just for this look; a photo's print keeps its picture.
      if (viewing.kind === 'pdf') URL.revokeObjectURL(viewing.url)
    }
  }, [viewing])

  if (files.length === 0) return null
  return (
    <div className="attachments" aria-label="קבצים מצורפים">
      {files.map((file) => (
        <FileCard key={file.key} file={file} onView={(url, kind) => setViewing({ url, file, kind })} />
      ))}

      {/* Shown over the whole screen: the letter it came from slides and scales, which would trap it inside. */}
      {viewing &&
        createPortal(
        <div className="lightbox" role="dialog" aria-label={viewing.file.filename}>
          <button className="lightbox-backdrop" aria-label="סגירה" onClick={() => setViewing(null)} />
          {viewing.kind === 'pdf' ? (
            <iframe className="lightbox-doc" src={viewing.url} title={viewing.file.filename} />
          ) : (
            <img src={viewing.url} alt={viewing.file.filename} />
          )}
          <div className="lightbox-bar">
            <button className="icon-btn" onClick={() => void save(viewing.file)} aria-label="הורדה" title="הורדה">
              <DownloadIcon />
            </button>
            <button className="icon-btn" onClick={() => setViewing(null)} aria-label="סגירה" title="סגירה">
              <CloseIcon />
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  )
}
