import { StrictMode, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import App from './App.jsx'
import Mobile from './Mobile.jsx'
import { AuthGate } from './auth.jsx'

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkWithRouter>
        <Routes>
          <Route path="/mobile" element={<AuthGate><Mobile /></AuthGate>} />
          <Route path="/*" element={<App />} />
        </Routes>
      </ClerkWithRouter>
    </BrowserRouter>
  </StrictMode>
)