import { Loader } from './components/Loader'
import { LoginScreen } from './components/LoginScreen'
import { Mailbox } from './components/Mailbox'
import { useSession } from './lib/auth'

export default function App() {
  const session = useSession()

  if (session === undefined) return <Loader />
  if (!session) return <LoginScreen />
  const { user } = session
  const name = (user.user_metadata as { full_name?: string }).full_name ?? ''
  return <Mailbox key={user.id} email={user.email ?? ''} name={name} />
}
