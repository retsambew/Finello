import { useEffect, useState } from 'react';

// Shared plumbing for the custom Select / ComboInput dropdown panels: track the
// trigger's on-screen position (recomputed on open, dropped on page scroll/resize
// so a stale panel never floats away from its trigger), place the panel above or
// below it, and close on outside click.
export function useAnchorRect(open, anchorRef) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    setRect(anchorRef.current.getBoundingClientRect());
  }, [open, anchorRef]);
  return rect;
}

const PANEL_GAP = 4;
const PANEL_MAX_HEIGHT = 280; // keep in sync with .select-panel max-height
const VIEWPORT_MARGIN = 8;

// Fixed-position style for a panel anchored to `rect`: opens below the trigger,
// or flips above it when there isn't room below and there's more room above.
// Max height is clamped to the chosen side's space so options never get cut off.
export function panelStyle(rect) {
  const below = window.innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
  const above = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
  const up = below < PANEL_MAX_HEIGHT && above > below;
  return {
    left: rect.left,
    minWidth: rect.width,
    maxHeight: Math.min(PANEL_MAX_HEIGHT, up ? above : below),
    ...(up ? { bottom: window.innerHeight - rect.top + PANEL_GAP } : { top: rect.bottom + PANEL_GAP }),
  };
}

export function useDismiss(open, refs, onDismiss) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (refs.some((r) => r.current && r.current.contains(e.target))) return;
      onDismiss();
    };
    const away = () => onDismiss();
    // Capture-phase scroll also sees the panel's own scrolling — only close
    // when something other than the panel/trigger scrolled.
    const scrolled = (e) => {
      if (refs.some((r) => r.current && r.current.contains(e.target))) return;
      onDismiss();
    };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', away);
    };
  }, [open, onDismiss]);
}
