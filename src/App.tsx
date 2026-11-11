import { Inbox } from './components/Inbox'
import { LoginScreen } from './components/LoginScreen'
import { useSession } from './lib/auth'

export default function App() {
  const session = useSession()

  if (session === undefined) return <div className="splash" aria-busy="true" />
  if (!session) return <LoginScreen />
  return <Inbox email={session.user.email ?? ''} />
}
