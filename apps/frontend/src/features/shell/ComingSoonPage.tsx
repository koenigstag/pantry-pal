import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/** A section that exists in the navigation but not yet in the product. */
export function ComingSoonPage({
  title,
  description,
  icon: Icon,
}: ComingSoonPageProps): ReactElement {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] md:px-8 md:pt-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <div className="mt-16 flex flex-col items-center gap-3 text-center text-ink-muted">
        <Icon aria-hidden="true" className="size-10" strokeWidth={1.5} />
        <p>{description}</p>
      </div>
    </div>
  );
}
