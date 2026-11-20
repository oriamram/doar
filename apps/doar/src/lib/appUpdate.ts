import { keepAppUpdated as keepUpdated } from '@doar/core/appUpdate.ts'
import { mailbox } from './mailbox'

/**
 * Keeps the installed app up to date (the way every app on the desk does it, see
 * packages/core/appUpdate.ts). Doar never reloads under a letter you're writing: the
 * new version waits for the form to close.
 */
export const keepAppUpdated = () => keepUpdated(() => !!mailbox.state().compose)
