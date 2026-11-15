import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// The world explorer is the app; ?classic keeps the original Nordic island map.
const App = new URLSearchParams(location.search).has('classic') ? lazy(() => import('./App.tsx')) : lazy(() => import('./v2/App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
)
