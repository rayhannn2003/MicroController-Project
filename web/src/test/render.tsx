import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { ToastProvider } from '../components/layout/Toasts';
import { ThemeProvider } from '../lib/theme';

/** Renders a route element with the app's providers and an in-memory router at `url`. */
export function renderRoute(element: ReactElement, { url = '/', path = '/' } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
  });
  const routes: RouteObject[] = [{ path, element: <ToastProvider>{element}</ToastProvider> }];
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...result, router, queryClient };
}
