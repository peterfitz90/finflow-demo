import { SignIn, useAuth, useUser, SignOutButton } from '@clerk/clerk-react'

const CSS_AUTH = `
  .auth-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a2744;
    font-family: 'Source Sans 3', sans-serif;
  }
  .auth-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }
  .auth-logo {
    font-family: 'Playfair Display', serif;
    font-size: 2rem;
    color: #faf9f7;
    letter-spacing: -0.01em;
  }
  .auth-logo span { color: #1d6b72; }
  .auth-tagline {
    font-size: 0.82rem;
    color: #8899bb;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-top: -1.5rem;
  }
`

// Sign-in screen shown to unauthenticated users
export function AuthScreen() {
  return (
    <>
      <style>{CSS_AUTH}</style>
      <div className="auth-screen">
        <div className="auth-wrap">
          <div className="auth-logo">Fin<span>flow</span></div>
          <div className="auth-tagline">Finance OS · Ireland</div>
          <SignIn routing="hash" />
        </div>
      </div>
    </>
  )
}

// Gate — shows auth screen if not signed in, children if signed in
export function AuthGate({ children }) {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return null
  if (!isSignedIn) return <AuthScreen />
  return children
}

// User chip — replaces the hardcoded PB / P. Brennan in the topbar
export function UserChip() {
  const { user } = useUser()
  if (!user) return null

  const initials = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('') || user.emailAddresses[0].emailAddress[0].toUpperCase()
  const name = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.emailAddresses[0].emailAddress

  return (
    <SignOutButton>
      <div className="user-chip" title="Click to sign out" style={{ cursor: 'pointer' }}>
        <div className="user-av">{initials}</div>
        <span className="user-name">{name}</span>
      </div>
    </SignOutButton>
  )
}
