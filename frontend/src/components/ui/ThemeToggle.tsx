import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme, type ThemeChoice } from '@/contexts/ThemeContext';
import useFloatingDropdown from '@/components/ui/useFloatingDropdown';
import { cn } from '@/utils/cn';

const OPTIONS: Array<{ value: ThemeChoice; label: string; hint: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
  { value: 'system', label: 'System', hint: 'Match my device', icon: Monitor },
];

/**
 * Topbar theme control. Renders as an icon button showing the *active* theme,
 * opening a menu with the three choices — a plain on/off switch can't express
 * "follow the system", which is the default.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { choice, theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { panelRef, panelStyle } = useFloatingDropdown(buttonRef, open);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panelRef]);

  const ActiveIcon = theme === 'dark' ? Moon : Sun;
  const activeOption = OPTIONS.find((option) => option.value === choice) ?? OPTIONS[2];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${activeOption.label}. Change theme`}
        title={`Theme: ${activeOption.label}`}
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition',
          'hover:border-blue-500/40 hover:text-slate-900',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
          open && 'border-blue-500/50 text-slate-900',
          className
        )}
      >
        <ActiveIcon className="h-[18px] w-[18px]" />
      </button>

      {open && panelStyle
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              role="menu"
              aria-label="Theme"
              className="min-w-[13rem] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-modal"
            >
              {OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = choice === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      setTheme(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition',
                      selected ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.hint}</span>
                    </span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
