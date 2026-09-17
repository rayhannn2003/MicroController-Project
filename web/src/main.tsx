import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { createQueryClient } from './lib/queryClient';
import { ThemeProvider } from './lib/theme';
import { createRouter } from './router';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={createRouter()} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
