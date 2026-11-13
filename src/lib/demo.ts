/**
 * The demo mailbox: Doar running on made-up mail, with no sign-in.
 * Open the site with "?demo" in the address. Nothing in it reaches Gmail or Doar's server.
 */

const param = new URLSearchParams(window.location.search).get('demo')

export const isDemo = param !== null

/** "?demo=fast": answers come at once (used by the automatic screen checks). */
export const demoFast = param === 'fast'

/** What to keep in the address bar so a reload stays in the demo. */
export const demoQuery = isDemo ? (demoFast ? '?demo=fast' : '?demo') : ''

export const DEMO_ME = { name: 'אורח', email: 'me@doar.example' }

/** Keys for things kept on this device. The demo keeps its own, so it never touches the real ones. */
export const storageKey = (name: string) => (isDemo ? `${name}:demo` : name)
