import { Package } from 'lucide-react';
import { useId, type ReactElement, type ReactNode } from 'react';

import { cn } from '../../ui/cn';

/**
 * The item modal's two columns, shared by the details view and the edit form so
 * switching between them keeps the photo and the sections in place: stacked on a
 * phone, the photo beside the content from `md` up.
 */
export const DETAILS_GRID =
  'grid gap-5 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8 md:p-6';

/** The photo placeholder. `className` decides whether and when it shows. */
export function ItemPhoto({ className }: { className: string }): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'aspect-[4/3] items-center justify-center rounded-2xl bg-sunken text-ink-muted md:aspect-square md:self-start',
        className,
      )}
    >
      <Package className="size-1/4" strokeWidth={1} />
    </div>
  );
}

export function DetailsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-line p-4">
      <h3
        id={headingId}
        className="mb-3 text-xs font-semibold tracking-wide text-ink-muted uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
