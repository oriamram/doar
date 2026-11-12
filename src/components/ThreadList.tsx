import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { shortName } from '../lib/addresses'
import { newDraft } from '../lib/compose'
import { countLetters, dayGroup } from '../lib/format'
import { mailbox, useMailbox, type Bundle } from '../lib/mailbox'
import { useSettings } from '../lib/settings'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { BUNDLE_TITLES, INBOX, isFolder, isInboxLike, viewKey, viewTitle, type View } from '../lib/views'
import type { Thread } from '../types'
import {
  ArchiveIcon,
  CloseIcon,
  MailIcon,
  MailOpenIcon,
  MenuIcon,
  NibIcon,
  RefreshIcon,
  RestoreIcon,
  SearchIcon,
  TagIcon,
  TrashIcon,
} from './icons'
import { Loader } from './Loader'
import { MailSlot } from './MailSlot'
import { SenderStamp, TwineBow } from './Postal'
import { ThreadRow } from './ThreadRow'

type Props = {
  searching: boolean
  onSearching: (searching: boolean) => void
  onMenu: () => void
  onAccount: () => void
  onLabels: (ids: string[]) => void
}

type Item = { kind: 'day'; label: string } | { kind: 'thread'; thread: Thread } | { kind: 'bundle'; bundle: Bundle }

/** The list in reading order: letters and bundles by date, under day headings. */
function buildItems(threads: Thread[], bundles: Bundle[]): Item[] {
  const rows: { date: string; item: Item }[] = [
    ...threads.map((thread) => ({ date: thread.date, item: { kind: 'thread', thread } as Item })),
    ...bundles.map((bundle) => ({ date: bundle.threads[0]!.date, item: { kind: 'bundle', bundle } as Item })),
  ]
  if (bundles.length) rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const now = new Date()
  const items: Item[] = []
  let heading = ''
  for (const row of rows) {
    const label = dayGroup(row.date, now)
    if (label !== heading) {
      items.push({ kind: 'day', label })
      heading = label
    }
    items.push(row.item)
  }
  return items
}

function emptyText(view: View): string {
  if (view.kind === 'search') return `לא נמצא דואר עבור „${view.query}”.`
  if (view.kind === 'bundle') return 'הצרור ריק.'
  if (view.kind === 'label') return 'אין מכתבים עם התווית הזאת.'
  switch (view.id) {
    case 'inbox':
      return 'תיבת הדואר ריקה. תיהנו מהשקט.'
    case 'unread':
      return 'הכל נקרא. אין מה להשלים.'
    case 'starred':
      return 'אין מכתבים מסומנים בכוכב.'
    case 'drafts':
      return 'אין טיוטות. מכתב שתתחילו לכתוב יישמר כאן.'
    case 'sent':
      return 'עוד לא שלחתם מכתבים.'
    case 'spam':
      return 'אין ספאם. יופי.'
    case 'trash':
      return 'האשפה ריקה.'
    default:
      return 'אין כאן מכתבים.'
  }
}

const QUICK_SEARCHES = [
  { label: 'עם קבצים מצורפים', query: 'has:attachment' },
  { label: 'מהשבוע האחרון', query: 'newer_than:7d' },
  { label: 'ממני', query: 'from:me' },
]

/** A bundle: several letters of one kind, tied with twine. */
function BundleRow({ bundle }: { bundle: Bundle }) {
  const unread = bundle.threads.filter((thread) => thread.unread).length
  const newest = bundle.threads[0]!
  const senders = [...new Set(bundle.threads.map((thread) => shortName(thread.from)))]
  const count = bundle.more ? `מעל ${bundle.threads.length} מכתבים` : countLetters(bundle.threads.length)
  return (
    <button type="button" className="bundle" data-unread={unread > 0 || undefined} onClick={() => mailbox.show({ kind: 'bundle', category: bundle.category })}>
      <span className="bundle-sheet">
        <span className="bundle-stamps" aria-hidden="true">
          {bundle.threads.slice(0, 3).map((thread) => (
            <SenderStamp key={thread.id} contact={thread.from} used={!thread.unread} />
          ))}
        </span>
        <span className="bundle-main">
          <span className="bundle-top">
            <span className="bundle-tag">{BUNDLE_TITLES[bundle.category]}</span>
            <span className="bundle-count">{count}</span>
            {unread > 0 && <span className="bundle-new">{unread} חדשים</span>}
          </span>
          <span className="bundle-senders ellipsis" dir="auto">
            {senders.slice(0, 3).join(', ')}
            {senders.length > 3 && ' ועוד'}
          </span>
          <span className="bundle-latest ellipsis" dir="auto">
            {newest.subject}
          </span>
        </span>
      </span>
      <span className="twine twine-across" aria-hidden="true" />
      <span className="twine twine-down" aria-hidden="true" />
      <TwineBow />
    </button>
  )
}

export function ThreadList({ searching, onSearching, onMenu, onAccount, onLabels }: Props) {
  const { view, threads, bundles, loading, loadingMore, nextPageToken, error, unread, labels, open, selection, arrived, me, online } =
    useMailbox()
  const settings = useSettings()
  const [searchText, setSearchText] = useState(view.kind === 'search' ? view.query : '')
  const [listElement, setListElement] = useState<HTMLElement | null>(null)
  const sentinel = useRef<HTMLLIElement>(null)

  // Pull the list down from the top to check for new mail (touch screens).
  const { pull, phase: pullPhase } = usePullToRefresh(listElement, mailbox.reload)

  const inInbox = isFolder(view, 'inbox')
  const showFilters = (inInbox || isFolder(view, 'unread') || isFolder(view, 'starred')) && !searching && selection.size === 0
  const items = useMemo(
    () => buildItems(threads ?? [], inInbox && settings.bundles ? bundles : []),
    [threads, bundles, inInbox, settings.bundles],
  )

  // Reaching the end of the list fetches the next page.
  useEffect(() => {
    const target = sentinel.current
    if (!target || !listElement || !nextPageToken || loadingMore || loading) return
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void mailbox.loadMore(), {
      root: listElement,
      rootMargin: '300px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [listElement, nextPageToken, loadingMore, loading])

  // New mail gets a short entrance; after that it's just mail.
  useEffect(() => {
    if (arrived.size === 0) return
    const timer = setTimeout(mailbox.clearArrived, 1600)
    return () => clearTimeout(timer)
  }, [arrived])

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const query = searchText.trim()
    if (query) mailbox.show({ kind: 'search', query })
  }

  const closeSearch = () => {
    onSearching(false)
    setSearchText('')
    if (view.kind === 'search') mailbox.show(INBOX)
  }

  const selected = [...selection]
  const selectedThreads = (threads ?? []).filter((thread) => selection.has(thread.id))
  const anyUnread = selectedThreads.some((thread) => thread.unread)
  const filters = [
    { view: INBOX, label: 'הכל' },
    { view: { kind: 'folder', id: 'unread' } as View, label: 'לא נקראו', count: unread },
    { view: { kind: 'folder', id: 'starred' } as View, label: 'מסומנים' },
  ]

  return (
    <section className="list" aria-label={viewTitle(view)} ref={setListElement}>
      <header className="list-header">
        <div className="airmail-band" aria-hidden="true" />

        {selection.size > 0 ? (
          <div className="header-row select-row">
            <button className="icon-btn" onClick={mailbox.clearSelection} aria-label="ביטול הבחירה">
              <CloseIcon />
            </button>
            <span className="select-count">{selection.size} נבחרו</span>
            {isFolder(view, 'trash') ? (
              <button className="icon-btn" onClick={() => mailbox.untrash(selected)} aria-label="שחזור מהאשפה" title="שחזור מהאשפה">
                <RestoreIcon />
              </button>
            ) : (
              <>
                <button
                  className="icon-btn"
                  onClick={() => mailbox.setRead(selected, anyUnread, { announce: true })}
                  aria-label={anyUnread ? 'סימון כנקרא' : 'סימון כלא נקרא'}
                  title={anyUnread ? 'סימון כנקרא' : 'סימון כלא נקרא'}
                >
                  {anyUnread ? <MailOpenIcon /> : <MailIcon />}
                </button>
                <button className="icon-btn" onClick={() => onLabels(selected)} aria-label="תוויות" title="תוויות">
                  <TagIcon />
                </button>
                <button className="icon-btn" onClick={() => mailbox.trash(selected)} aria-label="מחיקה" title="מחיקה">
                  <TrashIcon />
                </button>
                {selectedThreads.some((thread) => thread.labelIds.includes('INBOX')) && (
                  <button className="icon-btn" onClick={() => mailbox.archive(selected)} aria-label="תיוק" title="תיוק">
                    <ArchiveIcon />
                  </button>
                )}
              </>
            )}
          </div>
        ) : searching ? (
          <form className="header-row search-row" role="search" onSubmit={submitSearch}>
            <SearchIcon />
            <input
              className="search-input"
              type="search"
              enterKeyHint="search"
              placeholder="חיפוש בכל הדואר"
              aria-label="חיפוש בכל הדואר"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              autoFocus
            />
            <button type="button" className="icon-btn" onClick={closeSearch} aria-label="סגירת החיפוש">
              <CloseIcon />
            </button>
          </form>
        ) : (
          <div className="header-row">
            <button className="icon-btn menu-btn" onClick={onMenu} aria-label="תיקיות ותוויות">
              <MenuIcon />
            </button>
            <h1 className="view-title ellipsis">{viewTitle(view)}</h1>
            <button className="icon-btn" onClick={() => onSearching(true)} aria-label="חיפוש" title="חיפוש ( / )">
              <SearchIcon />
            </button>
            <button
              className="icon-btn refresh-btn"
              onClick={() => void mailbox.reload()}
              disabled={loading}
              data-spinning={loading || undefined}
              aria-label="בדיקת דואר חדש"
              title="בדיקת דואר חדש"
            >
              <RefreshIcon />
            </button>
            <button className="me" onClick={onAccount} aria-label="הגדרות וחשבון" title={me.email}>
              {(me.name || me.email)[0]?.toUpperCase() ?? '?'}
            </button>
          </div>
        )}

        {searching && selection.size === 0 && view.kind !== 'search' && (
          <div className="filters" aria-label="חיפושים מהירים">
            {QUICK_SEARCHES.map((quick) => (
              <button
                key={quick.query}
                className="filter"
                onClick={() => {
                  setSearchText(quick.query)
                  mailbox.show({ kind: 'search', query: quick.query })
                }}
              >
                {quick.label}
              </button>
            ))}
          </div>
        )}

        {showFilters && (
          <div className="filters" role="tablist" aria-label="סינון">
            {filters.map((filter) => {
              const active = viewKey(view) === viewKey(filter.view)
              return (
                <button key={viewKey(filter.view)} role="tab" className="filter" aria-selected={active} onClick={() => !active && mailbox.show(filter.view)}>
                  {filter.label}
                  {!!filter.count && <span className="filter-count">{filter.count}</span>}
                </button>
              )
            })}
          </div>
        )}

        {view.kind === 'bundle' && !!threads?.length && selection.size === 0 && (
          <div className="filters">
            <button className="filter" onClick={() => mailbox.archive(threads.map((thread) => thread.id))}>
              <ArchiveIcon />
              לתייק את כל הצרור
            </button>
          </div>
        )}

        <span className="progress" data-active={loading || undefined} aria-hidden="true" />
      </header>

      <MailSlot pull={pull} phase={pullPhase} />

      {!online && <p className="notice">אין חיבור לאינטרנט. מוצג הדואר שכבר נטען.</p>}

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button onClick={() => void mailbox.reload()}>לנסות שוב</button>
        </div>
      )}

      <motion.ul className="threads" data-stale={(loading && !!threads && pullPhase !== 'refreshing') || undefined} style={{ y: pull }}>
        {items.map((item) =>
          item.kind === 'day' ? (
            <li key={`day-${item.label}`} className="day">
              <span className="day-stamp">{item.label}</span>
            </li>
          ) : item.kind === 'bundle' ? (
            <li key={`bundle-${item.bundle.category}`}>
              <BundleRow bundle={item.bundle} />
            </li>
          ) : (
            <li key={item.thread.id}>
              <ThreadRow
                thread={item.thread}
                view={view}
                labels={labels}
                selected={selection.has(item.thread.id)}
                selecting={selection.size > 0}
                current={open?.id === item.thread.id}
                arrived={arrived.has(item.thread.id)}
              />
            </li>
          ),
        )}

        {threads === null && !error && (
          <li className="list-wait">
            <Loader compact label="מביאים את המכתבים…" />
          </li>
        )}
        {threads?.length === 0 && items.length === 0 && !loading && (
          <li className="empty">
            <span className="empty-stamp">{isInboxLike(view) ? 'אין דואר' : 'ריק'}</span>
            <span>{emptyText(view)}</span>
          </li>
        )}
        {nextPageToken && threads && (
          <li className="more" ref={sentinel}>
            {loadingMore ? 'מביאים עוד מכתבים…' : ''}
          </li>
        )}
        {!nextPageToken && !!threads?.length && threads.length > 12 && <li className="more">{countLetters(threads.length)}. זה הכל.</li>}
      </motion.ul>

      <button className="compose-fab" onClick={() => mailbox.compose(newDraft())} aria-label="כתיבת מכתב חדש">
        <NibIcon />
        <span>מכתב חדש</span>
      </button>
    </section>
  )
}
