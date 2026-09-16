import { useId, type ReactElement, type ReactNode } from 'react';

import { cn } from './cn';

const CONTROL_BASE =
  'w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-invalid:border-danger';

/** Classes for an input or select inside a `Field`. */
export const FIELD_CONTROL = `${CONTROL_BASE} h-10`;

/** Classes for a textarea inside a `Field`. */
export const FIELD_TEXTAREA = `${CONTROL_BASE} min-h-24 py-2`;

export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  label: string;
  /** Keeps the label for assistive technology only, where a heading already names the field. */
  hideLabel?: boolean;
  hint?: string;
  error: string | undefined;
  className?: string;
  /** Renders the control, spreading the props that tie it to the label, hint and error. */
  children: (props: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  className,
  children,
}: FieldProps): ReactElement {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ');

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-xs font-medium text-ink-muted', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
