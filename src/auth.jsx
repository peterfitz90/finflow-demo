import { SignIn, useAuth, useUser, SignOutButton } from '@clerk/clerk-react'

const CSS_AUTH = `
  .auth-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0c1210;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .auth-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }
  .auth-logo-lockup {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .auth-logo {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 1.6rem;
    font-weight: 700;
    color: #e8edeb;
    letter-spacing: -0.02em;
  }
  .auth-tagline {
    font-size: 0.82rem;
    color: #5c6662;
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
          <div className="auth-logo-lockup">
            <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
              <rect x="22" y="12" width="16" height="76" rx="8" fill="#e8edeb"/>
              <rect x="22" y="72" width="56" height="16" rx="8" fill="#e8edeb"/>
              <rect x="46" y="24" width="13" height="46" rx="6.5" fill="#10b981"/>
              <rect x="46" y="57" width="32" height="13" rx="6.5" fill="#10b981"/>
            </svg>
            <div className="auth-logo">Ledgrly</div>
          </div>
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
