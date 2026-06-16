import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  kind?: ToastKind;
  message: string;
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastInput, 'kind' | 'message'>> {
  id: number;
  durationMs: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  show: (t: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  error:   'bg-rose-50    border-rose-200    text-rose-900',
  warning: 'bg-amber-50   border-amber-200   text-amber-900',
  info:    'bg-sky-50     border-sky-200     text-sky-900',
};

const KIND_ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4" />,
  error:   <AlertCircle className="h-4 w-4" />,
  warning: <AlertCircle className="h-4 w-4" />,
  info:    <Info className="h-4 w-4" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((t: ToastInput) => {
    const id = Date.now() + Math.random();
    const item: ToastItem = {
      id,
      kind: t.kind ?? 'info',
      message: t.message,
      durationMs: t.durationMs ?? 4000,
    };
    setToasts(prev => [...prev, item]);
    setTimeout(() => dismiss(id), item.durationMs);
  }, [dismiss]);

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-md ${KIND_STYLES[t.kind]}`}
            role="status"
          >
            <span className="mt-0.5">{KIND_ICON[t.kind]}</span>
            <div className="flex-1 text-sm leading-snug">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback no-op toast (so the component compiles even if provider is missing)
    return {
      toasts: [],
      show: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}
