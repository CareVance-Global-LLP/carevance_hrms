import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export default function useFloatingDropdown(anchorRef: RefObject<HTMLElement | null>, open: boolean, offset = 8) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const needsFlipRef = useRef(false);

  const computeStyle = useCallback((panelHeight: number) => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    const maxH = Math.max((spaceBelow < panelHeight && spaceAbove >= panelHeight ? spaceAbove : spaceBelow) - offset, 100);

    if (spaceBelow < panelHeight && spaceAbove >= panelHeight) {
      return {
        position: 'fixed' as const,
        bottom: window.innerHeight - rect.top + offset,
        left: rect.left,
        width: rect.width,
        maxHeight: `${maxH}px`,
        overflowY: 'auto' as const,
        zIndex: 80,
      };
    }
    return {
      position: 'fixed' as const,
      top: rect.bottom + offset,
      left: rect.left,
      width: rect.width,
      maxHeight: `${maxH}px`,
      overflowY: 'auto' as const,
      zIndex: 80,
    };
  }, [anchorRef, offset]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      needsFlipRef.current = false;
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedHeight = 200;

    if (spaceBelow < estimatedHeight && spaceAbove >= estimatedHeight) {
      needsFlipRef.current = true;
      setPanelStyle(computeStyle(estimatedHeight));
    } else {
      needsFlipRef.current = false;
      setPanelStyle(computeStyle(estimatedHeight));
    }
  }, [anchorRef, offset, open, computeStyle]);

  useLayoutEffect(() => {
    if (!open || !needsFlipRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;

    const actualHeight = panel.scrollHeight + 4;
    const style = computeStyle(actualHeight);
    if (style) setPanelStyle(style);
    needsFlipRef.current = false;
  });

  useLayoutEffect(() => {
    if (!open) return;

    const onEvent = () => {
      const panel = panelRef.current;
      const h = panel ? panel.scrollHeight + 4 : 200;
      const style = computeStyle(h);
      if (style) setPanelStyle(style);
    };
    window.addEventListener('resize', onEvent);
    window.addEventListener('scroll', onEvent, true);
    return () => {
      window.removeEventListener('resize', onEvent);
      window.removeEventListener('scroll', onEvent, true);
    };
  }, [anchorRef, offset, open, computeStyle]);

  return { panelRef, panelStyle };
}
