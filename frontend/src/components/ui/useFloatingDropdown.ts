import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export default function useFloatingDropdown(anchorRef: RefObject<HTMLElement | null>, open: boolean, offset = 8) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + offset,
        left: rect.left,
        width: rect.width,
        zIndex: 80,
      });
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, offset, open]);

  return { panelRef, panelStyle };
}
