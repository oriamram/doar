import { Inbox } from './components/Inbox'
import { Loader } from './components/Loader'
import { LoginScreen } from './components/LoginScreen'
import { useSession } from './lib/auth'

export default function App() {
  const session = useSession()

  if (session === undefined) return <Loader />
  if (!session) return <LoginScreen />
  return <Inbox email={session.user.email ?? ''} />
}
