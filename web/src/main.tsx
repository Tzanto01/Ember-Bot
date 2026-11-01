import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { auth } from './lib/services';
import { syncThemeColor } from './lib/theme';
import { startApp } from './lib/startup';
import { clearOnUserChange, createQueryClient } from './query-client';
import { createAppRouter } from './router';
import './themes/index';

syncThemeColor();
const queryClient = createQueryClient();
clearOnUserChange(auth.me, queryClient);

await startApp();
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
