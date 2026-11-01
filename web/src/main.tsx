import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { asApiError } from './lib/problem';
import { startApp } from './lib/startup';
import { createAppRouter } from './router';
import './themes/index';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failures, error) => {
        const { status } = asApiError(error);
        return failures < 2 && !(status >= 400 && status < 500);
      },
    },
  },
});

await startApp();
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
