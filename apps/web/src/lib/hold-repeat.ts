import { useEffect, useRef } from "react";

const HOLD_DELAY = 400;
const FIRST_INTERVAL = 150;
const MIN_INTERVAL = 40;

/**
 * Press-and-hold repeat for stepper buttons. A tap (or Enter/Space) is a normal click;
 * holding fires `action` repeatedly, speeding up the longer it's held.
 * Spread the returned props onto the button.
 */
export function useHoldRepeat(action: () => void) {
  const actionRef = useRef(action);
  const timer = useRef<number | undefined>(undefined);
  // Set once repeating has started, so the click that ends the hold doesn't fire one more step.
  const repeated = useRef(false);

  useEffect(() => {
    actionRef.current = action;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const stop = () => clearTimeout(timer.current);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      stop();
      repeated.current = false;
      let interval = FIRST_INTERVAL;
      const tick = () => {
        repeated.current = true;
        actionRef.current();
        interval = Math.max(MIN_INTERVAL, interval * 0.85);
        timer.current = window.setTimeout(tick, interval);
      };
      timer.current = window.setTimeout(tick, HOLD_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Long-press on touch would otherwise open the context menu / callout.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (repeated.current) repeated.current = false;
      else actionRef.current();
    },
    className: "touch-none select-none [-webkit-touch-callout:none]",
  };
}
