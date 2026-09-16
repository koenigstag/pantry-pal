import { CircleAlert } from 'lucide-react';
import type { ReactElement } from 'react';

interface PageStatusProps {
  title: string;
  detail?: string | null;
  action?: { label: string; onClick: () => void };
  tone?: 'default' | 'error';
}

/** A whole-page placeholder: loading, a failed load, or nothing to show. */
export function PageStatus({
  title,
  detail,
  action,
  tone = 'default',
}: PageStatusProps): ReactElement {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center"
    >
      {tone === 'error' && <CircleAlert aria-hidden="true" className="size-8 text-danger" />}
      <p className="font-medium">{title}</p>
      {detail !== undefined && detail !== null && (
        <p className="max-w-md text-sm text-ink-muted">{detail}</p>
      )}
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="focus-ring mt-2 h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
