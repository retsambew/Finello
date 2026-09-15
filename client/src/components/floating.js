import { useEffect, useState } from 'react';

// Shared plumbing for the custom Select / ComboInput dropdown panels: track the
// trigger's on-screen position (recomputed on open, dropped on scroll/resize so a
// stale panel never floats away from its trigger) and close on outside click.
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

export function useDismiss(open, refs, onDismiss) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (refs.some((r) => r.current && r.current.contains(e.target))) return;
      onDismiss();
    };
    const away = () => onDismiss();
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open, onDismiss]);
}
