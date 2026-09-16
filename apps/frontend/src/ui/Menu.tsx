import { Check, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  type ToggleEvent,
} from 'react';

export interface MenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Set on radio-style items (a sort field, say): whether this one is chosen. */
  checked?: boolean;
}

/** Spread onto the trigger button: wires it to the popover and describes the menu it opens. */
export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  popoverTarget: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
}

interface MenuProps {
  /** Accessible name of the menu itself. */
  label: string;
  items: readonly MenuItem[];
  renderTrigger: (props: MenuTriggerProps) => ReactElement;
  /** Which edge of the trigger the menu lines up with (logical: `end` is right in LTR). */
  align?: 'start' | 'end';
}

const GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * A dropdown menu on the native Popover API.
 *
 * The browser supplies the top layer, light dismiss (outside click, Escape) and
 * the trigger's toggle behaviour. This component adds what the platform does
 * not: placement next to the trigger, arrow-key navigation, and closing on Tab,
 * scroll or resize, where a fixed-position menu would come loose from its
 * trigger.
 */
export function Menu({ label, items, renderTrigger, align = 'end' }: MenuProps): ReactElement {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const close = (event: Event): void => {
      const menu = menuRef.current;
      if (menu === null || (event.target instanceof Node && menu.contains(event.target))) return;
      menu.hidePopover();
    };

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [isOpen]);

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  }

  /** Runs before the menu is laid out, so it anchors by the trigger alone. */
  function handleBeforeToggle(event: ToggleEvent<HTMLDivElement>): void {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (event.newState !== 'open' || menu === null || trigger === null) return;

    const anchor = trigger.getBoundingClientRect();
    const isRtl = getComputedStyle(trigger).direction === 'rtl';
    const alignRight = (align === 'end') !== isRtl;

    menu.style.top = `${anchor.bottom + GAP_PX}px`;
    menu.style.left = alignRight ? 'auto' : `${anchor.left}px`;
    menu.style.right = alignRight ? `${window.innerWidth - anchor.right}px` : 'auto';
  }

  function handleToggle(event: ToggleEvent<HTMLDivElement>): void {
    const opened = event.newState === 'open';
    setOpen(opened);
    if (!opened) return;

    keepInViewport();
    menuItems()[0]?.focus();
  }

  /** Now that the menu has a size: flip above the trigger or shift sideways if it overflows. */
  function keepInViewport(): void {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (menu === null || trigger === null) return;

    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
      const above = trigger.getBoundingClientRect().top - GAP_PX - rect.height;
      menu.style.top = `${Math.max(VIEWPORT_MARGIN_PX, above)}px`;
    } else if (rect.top < VIEWPORT_MARGIN_PX) {
      // A trigger scrolled partly out of view (the page header scrolls away).
      menu.style.top = `${VIEWPORT_MARGIN_PX}px`;
    }
    if (rect.left < VIEWPORT_MARGIN_PX) {
      menu.style.left = `${VIEWPORT_MARGIN_PX}px`;
      menu.style.right = 'auto';
    } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
      menu.style.left = 'auto';
      menu.style.right = `${VIEWPORT_MARGIN_PX}px`;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const elements = menuItems();
    const current = elements.findIndex((element) => element === document.activeElement);
    const focusAt = (index: number): void => {
      elements.at(index % elements.length)?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current <= 0 ? -1 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(-1);
        break;
      case 'Tab':
        menuRef.current?.hidePopover();
        break;
    }
  }

  function select(item: MenuItem): void {
    menuRef.current?.hidePopover();
    triggerRef.current?.focus();
    item.onSelect();
  }

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        popoverTarget: id,
        'aria-haspopup': 'menu',
        'aria-expanded': isOpen,
        'aria-controls': id,
      })}
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onBeforeToggle={handleBeforeToggle}
        onToggle={handleToggle}
        onKeyDown={handleKeyDown}
        className="fixed inset-auto m-0 min-w-48 rounded-xl border border-line bg-surface p-1 text-ink shadow-lg"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isRadio = item.checked !== undefined;

          return (
            <button
              key={item.key}
              type="button"
              role={isRadio ? 'menuitemradio' : 'menuitem'}
              aria-checked={item.checked}
              tabIndex={-1}
              onClick={() => select(item)}
              className="focus-ring flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-sunken focus:bg-sunken"
            >
              {Icon !== undefined && <Icon aria-hidden="true" className="size-4 text-ink-muted" />}
              <span className="flex-1">{item.label}</span>
              {item.checked === true && <Check aria-hidden="true" className="size-4 text-accent" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
