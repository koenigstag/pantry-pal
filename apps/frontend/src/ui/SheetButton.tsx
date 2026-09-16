import type { LucideIcon } from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { cn } from './cn';

interface SheetButtonProps {
  icon: LucideIcon;
  label: string;
  /** A second line; for an unavailable option, why. */
  hint?: string;
  tone?: 'default' | 'danger';
  /** Shown and focusable, but inert: announced as disabled and described by `hint`. */
  unavailable?: boolean;
  onClick: () => void;
}

/** A full-width choice in a bottom sheet. */
export function SheetButton({
  icon: Icon,
  label,
  hint,
  tone = 'default',
  unavailable = false,
  onClick,
}: SheetButtonProps): ReactElement {
  const hintId = useId();

  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      aria-describedby={hint === undefined ? undefined : hintId}
      onClick={unavailable ? undefined : onClick}
      className={cn(
        'focus-ring flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-start transition-colors',
        unavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-sunken',
        tone === 'danger' && !unavailable && 'text-danger',
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{label}</span>
        {hint !== undefined && (
          <span id={hintId} className="text-sm text-ink-muted">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
