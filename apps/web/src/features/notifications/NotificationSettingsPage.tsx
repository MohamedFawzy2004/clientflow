import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { NotificationCategory, NotificationPreferenceView } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useCanNotify, usePreferences, useSavePreferences } from './api';

type Choice = Pick<NotificationPreferenceView, 'inApp' | 'email'>;

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] rounded-sm border-border-strong accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

/** Per-category channels (FR-X09). Emails are links only: what happened stays in the app. */
export function NotificationSettingsPage() {
  const allowed = useCanNotify();
  const query = usePreferences();
  const save = useSavePreferences();
  const [edits, setEdits] = useState<Partial<Record<NotificationCategory, Choice>>>({});

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Notifications are for team members"
      />
    );
  }

  const prefs = query.data?.data ?? [];
  const current = (p: NotificationPreferenceView): Choice => edits[p.category] ?? p;
  const dirty = prefs.filter((p) => {
    const c = edits[p.category];
    return c && (c.inApp !== p.inApp || c.email !== p.email);
  });
  const set = (p: NotificationPreferenceView, change: Partial<Choice>) =>
    setEdits((e) => ({ ...e, [p.category]: { ...current(p), ...change } }));

  const submit = () =>
    save
      .mutateAsync({
        // Only the choices: the API refuses unknown keys such as the label.
        preferences: dirty.map((p) => {
          const c = current(p);
          return { category: p.category, inApp: c.inApp, email: c.email };
        }),
      })
      .then(() => {
        setEdits({});
        toast.success('Notification settings saved');
      })
      .catch(() => undefined);

  return (
    <>
      <Link
        to="/app/notifications"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Notifications
      </Link>
      <h1 className="mt-1 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Notification settings
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Choose where each kind of notification reaches you. Emails only say that something happened
        and link to ClientFlow: names, amounts and messages stay behind your sign-in.
      </p>

      {save.error ? (
        <Banner tone="danger" title="Not saved" className="mt-6">
          {save.error instanceof ApiError
            ? (Object.values(save.error.fieldErrors)[0]?.[0] ?? save.error.message)
            : 'Something went wrong. Try again.'}
        </Banner>
      ) : null}

      <section
        aria-label="Channels per category"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {query.isPending ? (
          <div className="grid gap-3 p-5" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
          />
        ) : (
          <ul>
            {prefs.map((p) => {
              const c = current(p);
              return (
                <li
                  key={p.category}
                  className="flex flex-col gap-2 border-b border-border px-4 py-4 last:border-0 md:flex-row md:items-center md:justify-between md:gap-6 md:px-5"
                >
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-text">{p.label}</h2>
                    <p className="text-[13px] text-muted">{p.description}</p>
                    {!c.inApp && !c.email ? (
                      <p className="mt-1 text-[13px] font-medium text-warning">
                        You will not hear about these at all.
                      </p>
                    ) : null}
                  </div>
                  <fieldset className="flex shrink-0 gap-5">
                    <legend className="sr-only">{p.label}: channels</legend>
                    <Toggle
                      label="In the app"
                      checked={c.inApp}
                      onChange={(v) => set(p, { inApp: v })}
                    />
                    <Toggle
                      label="Email"
                      checked={c.email}
                      onChange={(v) => set(p, { email: v })}
                    />
                  </fieldset>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          onClick={submit}
          disabled={dirty.length === 0}
          loading={save.isPending}
          loadingLabel="Saving…"
        >
          Save changes
        </Button>
        {dirty.length > 0 ? (
          <Button variant="secondary" onClick={() => setEdits({})} disabled={save.isPending}>
            Discard
          </Button>
        ) : null}
      </div>
    </>
  );
}
