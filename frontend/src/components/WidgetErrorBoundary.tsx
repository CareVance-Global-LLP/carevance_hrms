import React, { type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { reportSilentError } from '@/lib/reportSilentError';

type Props = {
  children: ReactNode;
  /** Identifies the widget for error logging. */
  widgetName: string;
};

type State = { error: Error | null };

/**
 * Contains a crash to one widget/card on a page.
 *
 * RouteErrorBoundary catches render errors at the page level — one broken card
 * takes the whole page. This boundary wraps individual widgets so a failing
 * card shows a small inline fallback while the rest of the page keeps working.
 */
export default class WidgetErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportSilentError(`widget:${this.props.widgetName}`, error);
    console.error(`[widget:${this.props.widgetName}] render error`, {
      message: error?.message,
      stack: error?.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-800">This widget failed to load</p>
            <p className="mt-0.5 text-xs text-amber-600">
              {this.state.error.message || 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-200"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
