import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactElement } from 'react';

import { cn } from './cn';

type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'type'> & {
  icon: LucideIcon;
  /** The accessible name, and the tooltip unless `title` says otherwise. */
  label: string;
  size?: 'sm' | 'md';
};

const SIZES = {
  sm: { button: 'size-8', icon: 'size-4' },
  md: { button: 'size-10', icon: 'size-5' },
} as const;

/**
 * A round button showing only an icon.
 *
 * Colours come from `className`, because the same button sits on the accent
 * header and on plain surfaces. `aria-disabled` rather than `disabled` keeps a
 * button focusable and clickable, so it can explain why it does nothing yet.
 */
export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  title,
  className,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      className={cn(
        'focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:opacity-50',
        SIZES[size].button,
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" className={SIZES[size].icon} />
    </button>
  );
}
