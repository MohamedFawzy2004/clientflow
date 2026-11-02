import { Link } from 'react-router';
import { SearchX } from 'lucide-react';
import { EmptyState } from '../components/ui/feedback';

export function NotFoundPage({ standalone }: { standalone?: boolean }) {
  const content = (
    <EmptyState
      icon={<SearchX aria-hidden className="size-5" />}
      title="Page not found"
      description="The page you asked for does not exist, or you do not have access to it."
      action={
        <Link
          to="/app/dashboard"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Go to dashboard
        </Link>
      }
    />
  );
  return standalone ? (
    <div className="grid min-h-dvh place-items-center px-4">{content}</div>
  ) : (
    content
  );
}
