import { useState, useRef, useEffect, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/utils/cn';

interface InfoTooltipProps {
  content: ReactNode;
  title?: string;
  typical?: string;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Reusable info tooltip used across payroll setup and feature pages.
 *
 * Behaviour:
 *  - Hover or focus the icon → popup appears after a 200ms delay
 *  - Click the icon → popup toggles and locks open
 *  - Click outside or press Escape → popup closes
 *  - Keyboard accessible (focusable, aria-describedby)
 */
export default function InfoTooltip({
  content,
  title,
  typical,
  className,
  size = 'sm',
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (isHovered) setIsOpen(true);
    }, 200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!isOpen) return;
    timeoutRef.current = setTimeout(() => setIsOpen(false), 150);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((v) => !v);
  };

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <span
      ref={containerRef}
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={title ? `More info about ${title}` : 'More info'}
        aria-expanded={isOpen}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-slate-500 hover:text-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          isOpen && 'text-blue-600',
        )}
      >
        <Info className={iconSize} />
      </button>

      {isOpen && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2 w-72 max-w-[90vw] pointer-events-auto"
        >
          <span className="block bg-surface-inverse text-on-inverse text-xs leading-relaxed rounded-lg shadow-xl border border-slate-700 p-3">
            {title && (
              <span className="block font-semibold text-white mb-1">{title}</span>
            )}
            <span className="block text-slate-200">{content}</span>
            {typical && (
              <span className="block mt-2 pt-2 border-t border-slate-700 text-[11px] text-slate-300">
                <span className="font-medium text-slate-200">Typical: </span>
                {typical}
              </span>
            )}
            <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-surface-inverse border-l border-t border-slate-700 rotate-45" />
          </span>
        </span>
      )}
    </span>
  );
}
