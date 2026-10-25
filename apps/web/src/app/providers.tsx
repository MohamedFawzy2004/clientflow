import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => {
          const status = (err as { status?: number }).status ?? 0;
          // Never retry 4xx: a 403/404 will not change by asking again.
          return status >= 400 && status < 500 ? false : count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: 'font-sans !rounded-lg !border-border !shadow-pop',
            title: '!text-sm !font-semibold !text-text',
            description: '!text-[13px] !text-muted',
          },
        }}
      />
    </QueryClientProvider>
  );
}
