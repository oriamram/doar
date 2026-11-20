import { Loader } from './components/Loader'
import { LoginScreen } from './components/LoginScreen'
import { Mailbox } from './components/Mailbox'
import { useSession } from './lib/auth'
import { DEMO_ME, isDemo } from './lib/demo'

export default function App() {
  const session = useSession()

  // The demo mailbox: made-up mail, no sign-in.
  if (isDemo) return <Mailbox email={DEMO_ME.email} name={DEMO_ME.name} />

  if (session === undefined) return <Loader />
  if (!session) return <LoginScreen />
  const { user } = session
  const name = (user.user_metadata as { full_name?: string }).full_name ?? ''
  return <Mailbox key={user.id} email={user.email ?? ''} name={name} />
}
