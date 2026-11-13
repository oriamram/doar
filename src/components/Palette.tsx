import { useEffect, useMemo, useRef, useState } from 'react'
import { useBackLayer } from '../lib/layers'
import { SearchIcon } from './icons'

/** One place to go or thing to do. */
export type PaletteEntry = {
  id: string
  title: string
  /** What it is: "תיקייה", "תווית", "אדם", "פעולה". */
  hint: string
  /** More words it answers to (an address, an English name). */
  words?: string
  run: () => void
}

type Props = {
  entries: PaletteEntry[]
  onSearch: (query: string) => void
  onClose: () => void
}

const LIMIT = 9

/** "לאן?": type a few letters of a folder, a label, a person or an action, and go. */
export function Palette({ entries, onSearch, onClose }: Props) {
  const [typed, setTyped] = useState('')
  const [chosen, setChosen] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  useBackLayer(true, onClose)

  const query = typed.trim().toLowerCase()
  const found = useMemo(() => {
    if (!query) return entries.filter((entry) => entry.hint !== 'אדם').slice(0, LIMIT)
    const words = query.split(/\s+/)
    const scored = entries
      .map((entry) => {
        const title = entry.title.toLowerCase()
        const all = `${title} ${entry.words?.toLowerCase() ?? ''} ${entry.hint}`
        if (!words.every((word) => all.includes(word))) return null
        // A name that starts with what was typed comes before one that only holds it.
        return { entry, rank: title.startsWith(query) ? 0 : title.split(/\s+/).some((part) => part.startsWith(words[0]!)) ? 1 : 2 }
      })
      .filter((item) => item !== null)
    return scored
      .sort((a, b) => a.rank - b.rank)
      .slice(0, LIMIT)
      .map((item) => item.entry)
  }, [entries, query])

  // The last row always offers a plain search for what was typed.
  const rows = query ? found.length + 1 : found.length
  const at = Math.min(chosen, Math.max(rows - 1, 0))

  const run = (index: number) => {
    const entry = found[index]
    onClose()
    if (entry) entry.run()
    else if (query) onSearch(typed.trim())
  }

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  return (
    <div className="palette-layer" role="dialog" aria-modal="true" aria-label="לאן?">
      <button className="sheet-backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="palette">
        <label className="palette-box">
          <SearchIcon />
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={rows ? `palette-${at}` : undefined}
            placeholder="לאן? תיקייה, תווית, אדם או פעולה"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              setChosen(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setChosen((at + 1) % Math.max(rows, 1))
              else if (e.key === 'ArrowUp') setChosen((at - 1 + Math.max(rows, 1)) % Math.max(rows, 1))
              else if (e.key === 'Enter') run(at)
              else if (e.key === 'Escape') onClose()
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
            autoFocus
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {found.map((entry, index) => (
            <li key={entry.id} id={`palette-${index}`} role="option" aria-selected={index === at} onPointerMove={() => setChosen(index)} onClick={() => run(index)}>
              <span className="palette-title ellipsis" dir="auto">
                {entry.title}
              </span>
              <span className="palette-hint">{entry.hint}</span>
            </li>
          ))}
          {query && (
            <li id={`palette-${found.length}`} role="option" aria-selected={at === found.length} onPointerMove={() => setChosen(found.length)} onClick={() => run(found.length)}>
              <span className="palette-title ellipsis" dir="auto">
                לחפש „{typed.trim()}” בכל הדואר
              </span>
              <span className="palette-hint">חיפוש</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
