import { useState } from 'react';
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  zonedLocalToUtcIso,
  type ActivityKind,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Textarea } from '../../components/ui/form';
import { useLeadAction } from './api';

/** Log a note, call, email or meeting on the lead's timeline (FR-C08). */
export function TimelineComposer({
  leadId,
  timeZone,
  disabled,
}: {
  leadId: string;
  timeZone: string;
  disabled?: string;
}) {
  const action = useLeadAction(leadId);
  const [kind, setKind] = useState<ActivityKind>('NOTE');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return <p className="py-3 text-sm text-muted">{disabled}</p>;
  }

  const submit = () => {
    if (!body.trim()) {
      setError('Write something first.');
      return;
    }
    setError(null);
    const occurredAt = when ? (zonedLocalToUtcIso(when, timeZone) ?? undefined) : undefined;
    action.mutate(
      {
        kind: 'activity',
        body: { kind, body: body.trim(), ...(occurredAt ? { occurredAt } : {}) },
      },
      {
        onSuccess: () => {
          toast.success(`${ACTIVITY_KIND_LABELS[kind]} saved`);
          setBody('');
          setWhen('');
        },
        onError: (err) => {
          const first =
            err instanceof ApiError ? Object.values(err.fieldErrors)[0]?.[0] : undefined;
          setError(first ?? err.message);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 py-3">
      <div
        role="radiogroup"
        aria-label="Entry type"
        className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-surface-alt p-1"
      >
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'h-9 shrink-0 rounded-sm px-3.5 text-[13px] font-medium transition-colors md:h-8',
              kind === k
                ? 'bg-surface text-text shadow-[0_1px_2px_rgba(16,36,60,0.1)]'
                : 'text-muted hover:text-text',
            )}
          >
            {ACTIVITY_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {error ? (
        <Banner tone="danger" title="Not saved">
          {error}
        </Banner>
      ) : null}
      <Field
        label={
          kind === 'NOTE'
            ? 'Note'
            : `What happened on the ${ACTIVITY_KIND_LABELS[kind].toLowerCase()}?`
        }
        required
      >
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      {kind !== 'NOTE' ? (
        <Field label="When" hint={`Leave empty for now. ${timeZone.replace('_', ' ')} time.`}>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <div>
        <Button onClick={submit} loading={action.isPending} loadingLabel="Saving…">
          Save {ACTIVITY_KIND_LABELS[kind].toLowerCase()}
        </Button>
      </div>
    </div>
  );
}
