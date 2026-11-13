import type { ReactNode, SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

const Icon = ({ children }: { children: ReactNode }) => <svg {...base}>{children}</svg>

export const EditIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Icon>
)

/** Held mail: an hourglass. */
export const HoldIcon = () => (
  <Icon>
    <path d="M7 3h10M7 21h10M8 3v3a4 4 0 0 0 8 0V3M8 21v-3a4 4 0 0 1 8 0v3" />
  </Icon>
)

/** Registered mail: the "R" of the registered label. */
export const RegisteredIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M10 15.5v-7h2.5a2.1 2.1 0 0 1 0 4.2H10M12.3 12.7l2.2 2.8" />
  </Icon>
)

/** An express sender. */
export const ExpressIcon = () => (
  <Icon>
    <path d="M13 3 5 13h6l-1 8 8-10h-6z" />
  </Icon>
)

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
)

export const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01" />
  </Icon>
)

export const BellIcon = () => (
  <Icon>
    <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15zM10 21h4" />
  </Icon>
)

export const InstallIcon = () => (
  <Icon>
    <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
  </Icon>
)

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Icon>
)

export const ArchiveIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </Icon>
)

export const MailIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Icon>
)

export const MailOpenIcon = () => (
  <Icon>
    <path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M3 10l9 6 9-6" />
  </Icon>
)

export const StarIcon = ({ filled }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
  </svg>
)

export const BackIcon = () => (
  <Icon>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
)

export const InboxIcon = () => (
  <Icon>
    <path d="M3 13h5l2 3h4l2-3h5" />
    <path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
  </Icon>
)

export const SendIcon = () => (
  <Icon>
    <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
  </Icon>
)

export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Icon>
)

export const LogoutIcon = () => (
  <Icon>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const DraftIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </Icon>
)

export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)

/** A fountain-pen nib, for writing a new letter. */
export const NibIcon = () => (
  <Icon>
    <path d="M12 3l5 8-3.5 9h-3L7 11z" />
    <path d="M12 3v9" />
    <circle cx="12" cy="13.5" r="1.4" />
  </Icon>
)

export const AllMailIcon = () => (
  <Icon>
    <rect x="5" y="8" width="16" height="11" rx="1.5" />
    <path d="M5.5 9.5l7.5 5 7.5-5M3 15V6a1 1 0 0 1 1-1h13" />
  </Icon>
)

export const SpamIcon = () => (
  <Icon>
    <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
    <path d="M12 8v5M12 16.5v.1" />
  </Icon>
)

export const TagIcon = () => (
  <Icon>
    <path d="M3 12V4h8l10 10-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </Icon>
)

export const ReplyIcon = () => (
  <Icon>
    <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6v1" />
  </Icon>
)

export const ReplyAllIcon = () => (
  <Icon>
    <path d="M7 7l-5 5 5 5M12 7l-5 5 5 5M7 12h8a6 6 0 0 1 6 6v1" />
  </Icon>
)

export const ForwardIcon = () => (
  <Icon>
    <path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0-6 6v1" />
  </Icon>
)

export const ClipIcon = () => (
  <Icon>
    <path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />
  </Icon>
)

export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
  </Icon>
)

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.1M10 10h.1M14 10h.1M18 10h.1M7 14h10" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)

export const MoreIcon = () => (
  <Icon>
    <circle cx="12" cy="5" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="12" cy="19" r="1.2" />
  </Icon>
)

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const RestoreIcon = () => (
  <Icon>
    <path d="M4 9h10a6 6 0 0 1 0 12H9M4 9l4-4M4 9l4 4" />
  </Icon>
)

export const ListIcon = () => (
  <Icon>
    <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.1M4.5 12h.1M4.5 17h.1" />
  </Icon>
)

export const ChevronIcon = () => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

/** A parcel: a box tied with tape. */
export const ParcelIcon = () => (
  <Icon>
    <path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16zM3.5 8 12 12.5 20.5 8M12 12.5v8M7.7 5.8l8.6 4.6" />
  </Icon>
)

/** A receipt: narrow paper with a torn end. */
export const ReceiptIcon = () => (
  <Icon>
    <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6" />
  </Icon>
)

/** The receipts spike: a pin standing on its base, papers pushed onto it. */
export const SpikeIcon = () => (
  <Icon>
    <path d="M12 2v17M7 21h10M12 19c-2 0-4 .8-5 2M12 19c2 0 4 .8 5 2M6 9l12-2M5.5 13.5l13-1.5" />
  </Icon>
)

/** A calendar leaf. */
export const CalendarIcon = () => (
  <Icon>
    <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
  </Icon>
)

/** Return to sender: the pointing hand of the post office's stamp. */
export const HandIcon = () => (
  <Icon>
    <path d="M21 11H9.5M9.5 11V8.2c0-.9-.6-1.7-1.5-1.7H6.5L3 8.5v8l2.5 1.5h6a1.8 1.8 0 0 0 0-3.4M9.5 11h3.2a1.7 1.7 0 0 1 0 3.4H11M12 14.4h.6a1.6 1.6 0 0 1 0 3.2H11" />
  </Icon>
)

/** The stamp album: a book with a stamp on its page. */
export const AlbumIcon = () => (
  <Icon>
    <path d="M5 3h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5zM5 3v18M9 8h6v5H9z" />
  </Icon>
)

/** A person's card. */
export const CardIcon = () => (
  <Icon>
    <path d="M3 5h18v14H3zM7 15c.5-1.6 4.5-1.6 5 0M9.5 11.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4M15 9.5h3M15 13h3" />
  </Icon>
)

/** Reading aloud: a speaker. */
export const SpeakIcon = () => (
  <Icon>
    <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

/** Printing: a printer. */
export const PrintIcon = () => (
  <Icon>
    <path d="M7 8V4h10v4M7 17H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />
  </Icon>
)

/** A postal scale. */
export const ScaleIcon = () => (
  <Icon>
    <path d="M5 8h14M12 8v9M8 20h8M12 17c-2 0-3.5 1.2-4 3M12 17c2 0 3.5 1.2 4 3M9 5h6l1 3H8z" />
  </Icon>
)

/** A note: a slip with a folded corner. */
export const NoteIcon = () => (
  <Icon>
    <path d="M5 4h14v10l-5 6H5zM19 14h-5v6M8.5 9h7M8.5 12.5h4" />
  </Icon>
)

/** A shield: the inspector. */
export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6z" />
  </Icon>
)
