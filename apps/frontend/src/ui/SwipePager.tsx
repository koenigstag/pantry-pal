import { observer } from 'mobx-react-lite';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from './cn';

/** Below this much travel a gesture could still turn out to be the page scrolling. */
const AXIS_SLOP = 10;
/** Cross this much of the pager's width and letting go changes space. */
const COMMIT_FRACTION = 0.35;
/** A flick that fell short still changes space if it ended this fast (px/ms) and this far. */
const FLICK_VELOCITY = 0.5;
const FLICK_DISTANCE = 32;
/** How much each move's own speed counts towards the flick velocity; the rest carries over. */
const VELOCITY_WEIGHT = 0.7;
/** A finger that rested this long (ms) before lifting was not flicking. */
const VELOCITY_STALE = 100;
/** How far past the first or last space a drag can pull, as a fraction of the width. */
const OVERSCROLL_LIMIT = 0.12;
/** How much of the finger's travel that pull follows. */
const OVERSCROLL_RESISTANCE = 0.3;
/** The animation that finishes a swipe, or takes one that fell short back. */
const SETTLE_MS = 220;
const SETTLE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** A click this soon after a swipe was the swipe, not the card it ended over. */
const CLICK_GRACE_MS = 120;

/**
 * A swipe in progress, or the animation that ends it. `fromId` is the page the
 * pager was showing when it started: once that is no longer the open one, the
 * swipe arrived (or something else navigated), and the pan is over.
 */
type Pan = { phase: 'drag' | 'settle'; fromId: string };

/** One pointer, from the touch down until it lifts. Lives in a ref: it changes every frame. */
interface Gesture {
  pointerId: number;
  /** Moves by `AXIS_SLOP` once the axis is settled, so the panes start from rest. */
  startX: number;
  startY: number;
  /** The pager's width, measured once: a swipe across it all is a whole page. */
  width: number;
  /** -1 where the page reads right to left, so a drag's sign is its reading direction. */
  sign: number;
  axis: 'undecided' | 'x';
  /** The last move, and the flick velocity (px/ms) smoothed over the moves so far. */
  lastX: number;
  lastT: number;
  velocity: number;
}

interface SwipePagerProps<T extends { id: string }> {
  /** Every page the tabs offer, in the order they offer them. */
  pages: readonly T[];
  /** The page on screen, which is one of `pages`. */
  active: T;
  /**
   * A swipe settled on another page: go there, exactly as tapping its tab would
   * — normally a navigation, which brings that page back as `active`.
   */
  onSwipe: (id: string) => void;
  /**
   * One page's contents. Called for the open page, and for a neighbour while a
   * swipe is showing it — so it must render any page, not just the open one.
   */
  children: (page: T) => ReactNode;
}

/**
 * A row of tabs, swipeable: dragging sideways over the contents moves to the
 * next or previous tab's page, the neighbour's own contents following the finger
 * the whole way — half a swipe shows half of each — and letting go either
 * finishes the move or takes it back. The Storage page pages between storage
 * spaces this way, the Shopping page between shopping lists.
 *
 * The neighbours are real panes, rendered by the same `children` as the open
 * page and laid out either side of it, absolutely, so they take its height and
 * the page below does not move while they come into view. They are mounted only
 * while a swipe is showing them, and are `inert` and hidden from assistive
 * technology: the tabs are the way there for everyone not dragging a finger.
 *
 * It fills the height its parent leaves it (`flex-1`, in a page that is at least
 * a screen tall), so a page holding one row takes a swipe anywhere below it, not
 * only over that row.
 *
 * `onSwipe` navigates, exactly as tapping that tab would — so the back button
 * walks through the pages visited either way. The offset is dropped in the same
 * frame the new page arrives, where its pane stands exactly where the peek pane
 * stood, so nothing jumps.
 *
 * The drag itself costs no renders: the transform is written straight to the
 * track. React hears about a swipe twice, to mount the neighbours and to settle.
 */
export const SwipePager = observer(function SwipePager<T extends { id: string }>({
  pages,
  active,
  onSwipe,
  children,
}: SwipePagerProps<T>): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const settleTimer = useRef<number | null>(null);
  const swallowClickUntil = useRef(0);
  const [pan, setPan] = useState<Pan | null>(null);

  const index = pages.findIndex((candidate) => candidate.id === active.id);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index === -1 ? undefined : pages[index + 1];
  // A pan that started on another page is one the layout effect below is about
  // to end: its peek panes belong to that page, and are gone already.
  const isPanning = pan !== null && pan.fromId === active.id;

  function clearSettleTimer(): void {
    if (settleTimer.current === null) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }

  useEffect(() => () => clearSettleTimer(), []);

  useLayoutEffect(() => {
    if (pan !== null && pan.fromId !== active.id) {
      // The swipe arrived: the new page's pane stands exactly where the peek
      // pane stood, so dropping the offset now moves nothing on screen. A tab
      // tapped, or a page deleted, ends a pan the same way.
      gestureRef.current = null;
      clearSettleTimer();
      setPan(null);
      return;
    }

    const track = trackRef.current;
    if (pan === null && track !== null) {
      track.style.transition = '';
      track.style.transform = '';
    }
  }, [pan, active.id]);

  /** Where the track sits for a finger that has travelled `dx`. */
  function offsetFor(dx: number, gesture: Gesture): number {
    if ((dx * gesture.sign < 0 ? next : previous) !== undefined) {
      // No further than the neighbour: one page is as far as one swipe goes,
      // and past its far edge there would be nothing to show.
      return Math.sign(dx) * Math.min(Math.abs(dx), gesture.width);
    }

    // Nothing that way. The panes still give, a little, and spring back on release.
    return (
      Math.sign(dx) *
      Math.min(Math.abs(dx) * OVERSCROLL_RESISTANCE, gesture.width * OVERSCROLL_LIMIT)
    );
  }

  function offsetTrack(offset: number): void {
    if (trackRef.current !== null) {
      trackRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
  }

  function begin(event: ReactPointerEvent<HTMLDivElement>): void {
    // Touch and pen only: a mouse has the tabs, and dragging with one selects text.
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    // A settle still running, or nowhere to swipe to.
    if (pan !== null || (previous === undefined && next === undefined)) return;

    const viewport = viewportRef.current;
    if (viewport === null || viewport.clientWidth === 0) return;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: viewport.clientWidth,
      sign: getComputedStyle(viewport).direction === 'rtl' ? -1 : 1,
      axis: 'undecided',
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;

    if (gesture.axis === 'undecided') {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        // Vertical: the page is scrolling, and this pointer is no longer ours.
        gestureRef.current = null;
        return;
      }

      gesture.axis = 'x';
      // Measure from where the finger crossed the slop, so the panes start from
      // rest rather than jumping those pixels on the first frame.
      gesture.startX += Math.sign(dx) * AXIS_SLOP;
      event.currentTarget.setPointerCapture(gesture.pointerId);
      setPan({ phase: 'drag', fromId: active.id });
    }

    // This move's own speed, smoothed over the ones before it: a running measure
    // rather than one over a fixed window, which a device reporting moves slowly
    // would leave empty.
    const elapsed = Math.max(event.timeStamp - gesture.lastT, 1);
    const speed = (event.clientX - gesture.lastX) / elapsed;
    gesture.velocity = gesture.velocity * (1 - VELOCITY_WEIGHT) + speed * VELOCITY_WEIGHT;
    gesture.lastX = event.clientX;
    gesture.lastT = event.timeStamp;

    offsetTrack(offsetFor(event.clientX - gesture.startX, gesture));
  }

  /** The finger lifted — or the browser took the pointer, which only ever goes back. */
  function end(event: ReactPointerEvent<HTMLDivElement>, canCommit: boolean): void {
    const gesture = gestureRef.current;
    if (gesture === null || event.pointerId !== gesture.pointerId) return;

    gestureRef.current = null;
    if (gesture.axis !== 'x') return;

    // The finger travelled, so whatever it ended over was swiped, not tapped.
    swallowClickUntil.current = event.timeStamp + CLICK_GRACE_MS;

    const dx = event.clientX - gesture.startX;
    const neighbour = canCommit ? (dx * gesture.sign < 0 ? next : previous) : undefined;
    // A finger that came to rest before lifting was placing the panes, not flicking.
    const velocity = event.timeStamp - gesture.lastT > VELOCITY_STALE ? 0 : gesture.velocity;
    const flicked =
      Math.abs(dx) >= FLICK_DISTANCE &&
      Math.abs(velocity) >= FLICK_VELOCITY &&
      Math.sign(velocity) === Math.sign(dx);
    const destination =
      neighbour !== undefined && (Math.abs(dx) >= gesture.width * COMMIT_FRACTION || flicked)
        ? neighbour
        : undefined;

    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SETTLE_MS;
    if (trackRef.current !== null) {
      trackRef.current.style.transition = `transform ${duration}ms ${SETTLE_EASING}`;
    }
    offsetTrack(destination === undefined ? 0 : Math.sign(dx) * gesture.width);

    setPan({ phase: 'settle', fromId: active.id });
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      // Navigating is what ends a finished swipe: the layout effect above drops
      // the offset once the page it asked for is the open one. One that fell
      // short has slid back already, and only has to let go.
      if (destination === undefined) setPan(null);
      else onSwipe(destination.id);
    }, duration);
  }

  function swallowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (event.timeStamp >= swallowClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={viewportRef}
      // `clip` rather than `hidden`: the peek panes are cut off at the sides
      // without the page's own vertical scrolling moving in here. `flex-1` takes
      // whatever height the page leaves, so the empty part of a sparse page is
      // swipeable too.
      className="relative flex flex-1 flex-col touch-pan-y touch-pinch-zoom overflow-x-clip"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}
      onClickCapture={swallowClick}
    >
      <div ref={trackRef} className={cn('relative flex-1', isPanning && 'will-change-transform')}>
        {isPanning && previous !== undefined && <Peek side="start">{children(previous)}</Peek>}
        {children(active)}
        {isPanning && next !== undefined && <Peek side="end">{children(next)}</Peek>}
      </div>
    </div>
  );
});

/**
 * A neighbouring page, waiting just off the edge. It takes the track's height
 * (`inset-y-0`) — the screen's, or the open pane's where that is taller — and
 * keeps whatever does not fit to itself, so bringing it into view never moves
 * the page below.
 */
function Peek({ side, children }: { side: 'start' | 'end'; children: ReactNode }): ReactElement {
  return (
    <div
      aria-hidden="true"
      inert
      className={cn(
        'pointer-events-none absolute inset-y-0 w-full overflow-hidden',
        side === 'start' ? 'end-full' : 'start-full',
      )}
    >
      {children}
    </div>
  );
}
