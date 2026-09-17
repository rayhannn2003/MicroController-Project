import { useId, useState, type SubmitEvent } from 'react';
import { RANGE_PRESETS, rangeLabel, type RangeState } from '../../lib/range';
import { useFilters } from '../../lib/useFilters';
import { Button } from '../ui/Button';
import { IconCalendar, IconChevronDown } from '../ui/Icons';
import { Sheet } from './Sheet';

function todayString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function RangeForm({
  range,
  onApply,
}: {
  range: RangeState;
  onApply: (range: RangeState) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState(range.from ?? '');
  const [to, setTo] = useState(range.to ?? '');
  const invalid = from !== '' && to !== '' && from > to;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || (!from && !to)) return;
    onApply({ preset: 'custom', from: from || undefined, to: to || undefined });
  };

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Presets</legend>
        <div className="grid grid-cols-2 gap-2">
          {RANGE_PRESETS.map((option) => {
            const active = range.preset === option.preset;
            return (
              <Button
                key={option.preset}
                variant={active ? 'primary' : 'secondary'}
                aria-pressed={active}
                onClick={() => {
                  onApply({ preset: option.preset });
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <form onSubmit={submit} className="space-y-3" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Custom range</legend>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={`${id}-from`} className="text-sm text-ink-muted">
              From
              <input
                id={`${id}-from`}
                type="date"
                value={from}
                max={to || todayString()}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
                className="mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink"
              />
            </label>
            <label htmlFor={`${id}-to`} className="text-sm text-ink-muted">
              To
              <input
                id={`${id}-to`}
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => {
                  setTo(event.target.value);
                }}
                aria-describedby={invalid ? `${id}-error` : undefined}
                aria-invalid={invalid || undefined}
                className="mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-ink"
              />
            </label>
          </div>
        </fieldset>
        {invalid && (
          <p id={`${id}-error`} className="text-sm text-failed">
            “From” must be on or before “To”.
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={invalid || (!from && !to)}
        >
          Apply custom range
        </Button>
      </form>
    </div>
  );
}

/** Date range picker: inline presets on wide screens, a sheet everywhere for custom dates. */
export function RangeControl() {
  const { range, setRange } = useFilters();
  const [open, setOpen] = useState(false);

  const apply = (next: RangeState) => {
    setRange(next);
    setOpen(false);
  };

  return (
    <>
      <div
        role="group"
        aria-label="Date range"
        className="hidden items-center rounded-md border border-border bg-surface-muted p-0.5 xl:flex"
      >
        {RANGE_PRESETS.map((option) => {
          const active = range.preset === option.preset;
          return (
            <button
              key={option.preset}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setRange({ preset: option.preset });
              }}
              className={`min-h-10 rounded-sm px-3 text-sm font-medium transition-colors ${
                active ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {option.short}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={range.preset === 'custom'}
          onClick={() => {
            setOpen(true);
          }}
          className={`min-h-10 rounded-sm px-3 text-sm font-medium transition-colors ${
            range.preset === 'custom'
              ? 'bg-surface text-ink shadow-card'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {range.preset === 'custom' ? rangeLabel(range) : 'Custom…'}
        </button>
      </div>

      <Button
        className="xl:hidden"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <IconCalendar size={16} />
        <span className="max-w-[9rem] truncate sm:max-w-none">{rangeLabel(range)}</span>
        <span className="sr-only">, change date range</span>
        <IconChevronDown size={16} />
      </Button>

      <Sheet open={open} onOpenChange={setOpen} title="Date range">
        <RangeForm key={String(open)} range={range} onApply={apply} />
      </Sheet>
    </>
  );
}
