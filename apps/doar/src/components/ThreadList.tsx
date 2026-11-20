import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { matches } from '../../../../supabase/functions/postman/rules.ts'
import { shortName } from '../lib/addresses'
import { newDraft } from '../lib/compose'
import { countLetters, dayGroup } from '../lib/format'
import { isFresh, threadShape, type Shape } from '../lib/kinds'
import { mailbox, useMailbox, type Bundle } from '../lib/mailbox'
import type { Reminder } from '../lib/postman'
import { ritualQueue, ritualSize, type RitualItem } from '../lib/ritual'
import { recentSearches, rememberSearch } from '../lib/searches'
import { useSettings } from '../lib/settings'
import { useNow } from '../lib/useNow'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { BUNDLE_TITLES, INBOX, isFolder, isInboxLike, viewKey, viewTitle, type View } from '../lib/views'
import type { Thread } from '../types'
import {
  ArchiveIcon,
  CloseIcon,
  HoldIcon,
  MailIcon,
  MailOpenIcon,
  MenuIcon,
  NibIcon,
  RefreshIcon,
  RestoreIcon,
  SearchIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
} from './icons'
import { ParcelStrip, QueueTicket } from './Kinds'
import { Loader } from './Loader'
import { MailSlot } from './MailSlot'
import { ScheduledList } from './ScheduledList'
import { Tips } from './Tips'
import { SenderStamp, TwineBow } from './Postal'
import { ThreadRow } from './ThreadRow'

type RowMenu = { thread: Thread; x: number; y: number }

type Props = {
  searching: boolean
  onSearching: (searching: boolean) => void
  onMenu: () => void
  onAccount: () => void
  onLabels: (ids: string[]) => void
  /** Ask when to bring these letters back (the held-mail form). */
  onHold: (ids: string[]) => void
  /** Open the mail one letter at a time. */
  onRitual: (queue: RitualItem[]) => void
}

type Item = { kind: 'day'; label: string } | { kind: 'thread'; thread: Thread } | { kind: 'bundle'; bundle: Bundle }

/**
 * The list in reading order: letters and bundles by date, under day headings. Letters
 * that Doar's server just brought back (`back`) come first, under a heading of their own.
 */
function buildItems(threads: Thread[], bundles: Bundle[], back: ReadonlySet<string>): Item[] {
  const returned = threads.filter((thread) => back.has(thread.id))
  const rows: { date: string; item: Item }[] = [
    ...threads.filter((thread) => !back.has(thread.id)).map((thread) => ({ date: thread.date, item: { kind: 'thread', thread } as Item })),
    ...bundles.map((bundle) => ({ date: bundle.threads[0]!.date, item: { kind: 'bundle', bundle } as Item })),
  ]
  if (bundles.length) rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const now = new Date()
  const items: Item[] = []
  if (returned.length) items.push({ kind: 'day', label: 'חזרו אליך' }, ...returned.map((thread) => ({ kind: 'thread', thread }) as Item))
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
    case 'scheduled':
      return 'אין מכתבים שמחכים למועד. בכתיבת מכתב, השעון שליד „שליחה” קובע לו מועד.'
    case 'held':
      return 'אין מכתבים שמורים. שעון החול שעל מכתב מחזיק אותו עד מועד שתבחרו, ואז מחזיר אותו לכאן.'
    case 'waiting':
      return 'אין מכתבים רשומים שמחכים לתשובה. בכתיבת מכתב, ה־R שליד „שליחה” רושם אותו.'
    case 'sent':
      return 'עוד לא שלחתם מכתבים.'
    case 'archive':
      return 'עוד לא תייקתם מכתבים. מכתב שמתייקים מחכה כאן.'
    case 'spam':
      return 'אין ספאם. יופי.'
    case 'trash':
      return 'האשפה ריקה.'
    default:
      return 'אין כאן מכתבים.'
  }
}

/** Plain words for the parts of a search; each one writes (or takes off) a piece of the search text. */
const SEARCH_CHIPS = [
  { label: 'עם קובץ', piece: 'has:attachment' },
  { label: 'מהשבוע', piece: 'newer_than:7d' },
  { label: 'מהחודש', piece: 'newer_than:30d' },
  { label: 'ממני', piece: 'from:me' },
  { label: 'לא נקראו', piece: 'is:unread' },
  { label: 'בכוכב', piece: 'is:starred' },
  { label: 'בדואר הנכנס', piece: 'in:inbox' },
]

const pieces = (text: string) => text.split(/\s+/).filter(Boolean)

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

export function ThreadList({ searching, onSearching, onMenu, onAccount, onLabels, onHold, onRitual }: Props) {
  const { view, threads, bundles, loading, loadingMore, nextPageToken, error, unread, labels, open, selection, arrived, me, online, scheduled, server, rules, marks, reminders, notes } =
    useMailbox()
  // What Doar's server is keeping time for, by conversation. A letter that just came back says so first.
  const reminderOf = useMemo(() => {
    const byThread = new Map<string, Reminder>()
    for (const reminder of reminders) if (!byThread.has(reminder.threadId) || reminder.status === 'returned') byThread.set(reminder.threadId, reminder)
    return byThread
  }, [reminders])
  const express = useMemo(() => marks.filter((mark) => mark.mark === 'express').map((mark) => mark.match), [marks])
  const isExpress = (thread: Thread) => !thread.outgoing && express.some((match) => matches(match, thread.from.email.toLowerCase()))
  // The server looks once a minute while it has something to do for this account; ten minutes of silence means it is stuck.
  const serverBusy = !!server && (server.devices.length > 0 || rules.length > 0 || marks.length > 0)
  const serverQuietFor = server?.reachable && server.lookedAt ? Math.floor((server.askedAt - Date.parse(server.lookedAt)) / 60_000) : 0
  const inScheduled = isFolder(view, 'scheduled')
  const settings = useSettings()
  const [searchText, setSearchText] = useState(view.kind === 'search' ? view.query : '')
  const [listElement, setListElement] = useState<HTMLElement | null>(null)
  const sentinel = useRef<HTMLLIElement>(null)
  // The menu a right click opens on a letter (PC).
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null)
  const openRowMenu = useCallback((thread: Thread, x: number, y: number) => setRowMenu({ thread, x, y }), [])

  // Pull the list down from the top to check for new mail (touch screens).
  const { pull, phase: pullPhase } = usePullToRefresh(listElement, mailbox.reload)

  const inInbox = isFolder(view, 'inbox')
  const showFilters = (inInbox || isFolder(view, 'unread') || isFolder(view, 'all')) && !searching && selection.size === 0
  const back = useMemo(
    () => new Set(inInbox ? reminders.filter((reminder) => reminder.status === 'returned').map((reminder) => reminder.threadId) : []),
    [reminders, inInbox],
  )
  const items = useMemo(
    () => buildItems(threads ?? [], inInbox && settings.bundles ? bundles : [], back),
    [threads, bundles, inInbox, settings.bundles, back],
  )

  // What each letter is: a code, a parcel, a receipt, an invitation, a leaflet, or a letter.
  const shapes = useMemo(() => {
    const byThread = new Map<string, Shape>()
    for (const thread of [...(threads ?? []), ...bundles.flatMap((bundle) => bundle.threads)]) byThread.set(thread.id, threadShape(thread, settings.notKinds))
    return byThread
  }, [threads, bundles, settings.notKinds])
  const shapeOfThread = (thread: Thread): Shape => shapes.get(thread.id) ?? { kind: 'letter' }

  // What the postman brought and nobody opened yet: with three or more, it can be opened one by one.
  const brought = useMemo(() => (inInbox ? ritualQueue(threads ?? [], settings.bundles ? bundles : [], (thread) => shapes.get(thread.id) ?? { kind: 'letter' }) : []), [inInbox, threads, bundles, settings.bundles, shapes])
  const broughtCount = ritualSize(brought)

  // On the counter, above everything: codes that are still good, and parcels on their way.
  const now = useNow()
  const counter = useMemo(() => {
    const inbox = new Map<string, Thread>()
    if (inInbox) for (const thread of [...(threads ?? []), ...bundles.flatMap((bundle) => bundle.threads)]) if (thread.labelIds.includes('INBOX')) inbox.set(thread.id, thread)
    const codes: { thread: Thread; code: string }[] = []
    const parcels: { thread: Thread; shape: Extract<Shape, { kind: 'parcel' }> }[] = []
    const seen = new Set<string>()
    for (const thread of [...inbox.values()].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      const shape = shapes.get(thread.id)
      if (shape?.kind === 'code' && isFresh(thread.date, now)) codes.push({ thread, code: shape.code })
      if (shape?.kind === 'parcel' && shape.status !== 'delivered') {
        // Several letters about one parcel: the latest speaks for it.
        const key = shape.number ?? thread.id
        if (!seen.has(key)) parcels.push({ thread, shape })
        seen.add(key)
      }
    }
    return { codes: codes.slice(0, 3), parcels }
  }, [inInbox, threads, bundles, shapes, now])

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
    if (!query) return
    rememberSearch(query)
    mailbox.show({ kind: 'search', query })
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
    // "נכנס" rather than "הכל", so it can't be mistaken for "כל הדואר" beside it.
    { view: INBOX, label: 'נכנס' },
    { view: { kind: 'folder', id: 'unread' } as View, label: 'לא נקראו', count: unread },
    { view: { kind: 'folder', id: 'all' } as View, label: 'כל הדואר' },
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
            {selection.size < (threads?.length ?? 0) && (
              <button className="link-btn" onClick={mailbox.selectAll} title="בחירת כל המכתבים שברשימה">
                הכל
              </button>
            )}
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
                {selectedThreads.some((thread) => thread.labelIds.includes('INBOX')) && (
                  <button className="icon-btn" onClick={() => onHold(selected)} aria-label="להחזיר אליי במועד אחר" title="להחזיר אליי במועד אחר">
                    <HoldIcon />
                  </button>
                )}
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

        {searching && selection.size === 0 && (
          <div className="filters" aria-label="חלקי החיפוש">
            {view.kind !== 'search' &&
              recentSearches()
                .slice(0, 3)
                .map((query) => (
                  <button
                    key={`recent-${query}`}
                    className="filter"
                    dir="auto"
                    title="חיפוש קודם"
                    onClick={() => {
                      setSearchText(query)
                      mailbox.show({ kind: 'search', query })
                    }}
                  >
                    {query}
                  </button>
                ))}
            {SEARCH_CHIPS.map((chip) => {
              const on = pieces(searchText).includes(chip.piece)
              return (
                <button
                  key={chip.piece}
                  className="filter search-chip"
                  aria-pressed={on}
                  title={chip.piece}
                  onClick={() => {
                    // The chip writes its piece into the search (or takes it out), and the search runs again.
                    const query = (on ? pieces(searchText).filter((piece) => piece !== chip.piece) : [...pieces(searchText), chip.piece]).join(' ')
                    setSearchText(query)
                    if (query) mailbox.show({ kind: 'search', query })
                    else if (view.kind === 'search') mailbox.show(INBOX)
                  }}
                >
                  {chip.label}
                </button>
              )
            })}
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
            {threads.some((thread) => thread.unread) && (
              <button className="filter" onClick={() => mailbox.setRead(threads.map((thread) => thread.id), true, { announce: true })}>
                <MailOpenIcon />
                לסמן הכל כנקרא
              </button>
            )}
          </div>
        )}

        <span className="progress" data-active={loading || undefined} aria-hidden="true" />
      </header>

      <MailSlot pull={pull} phase={pullPhase} />

      {!online && <p className="notice">אין חיבור לאינטרנט. מוצג הדואר שכבר נטען.</p>}
      {online && serverBusy && serverQuietFor >= 10 && (
        <p className="notice">השרת של דואר לא בדק דואר כבר {serverQuietFor} דקות. התראות ותיוג אוטומטי עלולים להתעכב.</p>
      )}
      {inInbox && !searching && selection.size === 0 && <Tips />}
      {inInbox && !searching && selection.size === 0 && (counter.codes.length > 0 || counter.parcels.length > 0 || broughtCount >= 3) && (
        <div className="counter" aria-label="על הדלפק">
          {broughtCount >= 3 && (
            <button type="button" className="postman-strip" onClick={() => onRitual(brought)}>
              <span className="postman-text">
                <strong>הדוור הביא {broughtCount} מכתבים</strong>
                <span>לפתוח אחד־אחד</span>
              </span>
              <span className="twine twine-down" aria-hidden="true" />
              <TwineBow />
            </button>
          )}
          {counter.codes.map(({ thread, code }) => (
            <QueueTicket key={thread.id} thread={thread} code={code} now={now} />
          ))}
          <ParcelStrip parcels={counter.parcels} />
        </div>
      )}

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button onClick={() => void mailbox.reload()}>לנסות שוב</button>
        </div>
      )}

      <motion.ul className="threads" data-stale={(loading && !!threads && pullPhase !== 'refreshing') || undefined} style={{ y: pull }}>
        {inScheduled && <ScheduledList />}
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
                reminder={reminderOf.get(item.thread.id)}
                express={isExpress(item.thread)}
                shape={shapeOfThread(item.thread)}
                noted={item.thread.id in notes}
                onHold={onHold}
                onMenu={openRowMenu}
              />
            </li>
          ),
        )}

        {threads === null && !error && (
          <li className="list-wait">
            <Loader compact label="מביאים את המכתבים…" />
          </li>
        )}
        {threads?.length === 0 && items.length === 0 && !loading && !(inScheduled && scheduled.length > 0) && (
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

      {rowMenu &&
        (() => {
          const { thread, x, y } = rowMenu
          const ids = [thread.id]
          const inbox = thread.labelIds.includes('INBOX')
          const binned = thread.labelIds.includes('TRASH')
          const pick = (action: () => void) => () => {
            setRowMenu(null)
            action()
          }
          return (
            <>
              <button className="menu-backdrop" aria-label="סגירה" onClick={() => setRowMenu(null)} onContextMenu={(e) => (e.preventDefault(), setRowMenu(null))} />
              <div className="menu menu-floating" role="menu" style={{ left: Math.max(8, Math.min(x - 216, window.innerWidth - 232)), top: Math.max(8, Math.min(y, window.innerHeight - 330)) }}>
                <button role="menuitem" className="menu-item" onClick={pick(() => mailbox.open(thread))}>
                  <MailOpenIcon />
                  פתיחה
                </button>
                <button role="menuitem" className="menu-item" onClick={pick(() => mailbox.setRead(ids, thread.unread))}>
                  {thread.unread ? <MailOpenIcon /> : <MailIcon />}
                  {thread.unread ? 'סימון כנקרא' : 'סימון כלא נקרא'}
                </button>
                {!binned && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => mailbox.toggleStar(thread.id))}>
                    <StarIcon filled={thread.starred} />
                    {thread.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
                  </button>
                )}
                {inbox && !binned && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => mailbox.archive(ids))}>
                    <ArchiveIcon />
                    לתיוק
                  </button>
                )}
                {inbox && !binned && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => onHold(ids))}>
                    <HoldIcon />
                    להחזיר אליי במועד אחר
                  </button>
                )}
                {!binned && (
                  <button role="menuitem" className="menu-item" onClick={pick(() => onLabels(ids))}>
                    <TagIcon />
                    תוויות
                  </button>
                )}
                <button role="menuitem" className="menu-item" onClick={pick(() => (binned ? mailbox.untrash(ids) : mailbox.trash(ids)))}>
                  {binned ? <RestoreIcon /> : <TrashIcon />}
                  {binned ? 'שחזור מהאשפה' : 'לפח'}
                </button>
              </div>
            </>
          )
        })()}

      <button className="compose-fab" onClick={() => mailbox.compose(newDraft())} aria-label="כתיבת מכתב חדש">
        <NibIcon />
        <span>מכתב חדש</span>
      </button>
    </section>
  )
}
