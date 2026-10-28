import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@fontsource-variable/inter';
import './styles/index.css';
import { Providers } from './app/providers';
import { router } from './app/router';

// Start downloading the screen the URL asks for while the session check runs, instead of one
// after the other (M11, NFR-03). These are the same chunks the router loads; nothing runs early.
const path = window.location.pathname;
if (path.startsWith('/app')) {
  void import('./app/AppShell');
  if (path === '/app' || path.startsWith('/app/dashboard')) {
    void import('./features/dashboard/DashboardPage');
  }
} else if (path.startsWith('/portal')) {
  void import('./app/PortalShell');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
