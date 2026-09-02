import { StrictMode, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import App from './App.jsx'
import Mobile from './Mobile.jsx'
import { initSentry, Sentry } from './sentry.js'

initSentry();

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key — check your .env file')
}

// ClerkProvider is inside BrowserRouter so useNavigate is available.
// Stable useCallback references prevent Clerk from seeing changed props on
// every render, which would otherwise trigger unnecessary remounts.
function ClerkWithRouter({ children }) {
  const navigate = useNavigate();
  const routerPush    = useCallback((to) => navigate(to), [navigate]);
  const routerReplace = useCallback((to) => navigate(to, { replace: true }), [navigate]);
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignInUrl="/"
      afterSignUpUrl="/"
      routerPush={routerPush}
      routerReplace={routerReplace}
    >
      {children}
    </ClerkProvider>
  );
}

const CrashFallback = () => (
  <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#e4eaf4', background: '#0d1526', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
      <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 20 }}>This error has been reported. Please reload the page.</div>
      <button style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }} onClick={() => window.location.reload()}>Reload</button>
    </div>
  </div>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <BrowserRouter>
        <ClerkWithRouter>
          <Routes>
            <Route path="/mobile" element={<Mobile />} />
            <Route path="/*" element={<App />} />
          </Routes>
        </ClerkWithRouter>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>
)
