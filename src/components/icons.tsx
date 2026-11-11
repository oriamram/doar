import type { SVGProps } from 'react'

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

export const ArchiveIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </svg>
)

export const MailOpenIcon = () => (
  <svg {...base}>
    <path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M3 10l9 6 9-6" />
  </svg>
)

export const StarIcon = ({ filled }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
  </svg>
)

export const BackIcon = () => (
  <svg {...base}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export const InboxIcon = () => (
  <svg {...base}>
    <path d="M3 13h5l2 3h4l2-3h5" />
    <path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
  </svg>
)

export const SendIcon = () => (
  <svg {...base}>
    <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
  </svg>
)

export const RefreshIcon = () => (
  <svg {...base}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
)

export const LogoutIcon = () => (
  <svg {...base}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" />
  </svg>
)

export const DraftIcon = () => (
  <svg {...base}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
)
