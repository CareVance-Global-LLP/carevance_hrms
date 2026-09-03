import React, { type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { brandLabel } from '@/config/brand';

type Props = {
  children: ReactNode;
  /**
   * Changing this resets the boundary. Pass the current path so navigating
   * away from a broken page clears the error instead of following the user
   * around the app.
   */
  resetKey?: string;
};

type State = { error: Error | null };

/**
 * Contains a crash to one page.
 *
 * The app had exactly one error boundary, at the root, so any render error
 * anywhere replaced the entire application — navigation, sidebar and all —
 * with a full-screen crash notice. A failing widget on the payroll page took
 * away the user's ability to go anywhere else, which turns a small bug into a
 * total outage from the person's point of view.
 *
 * This sits inside the shell instead: the page reports that it broke, and
 * everything around it keeps working, so the user can navigate away.
 */
export default class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    // Navigating away is itself the recovery. Without this the error sticks to
    // the shell and every subsequent page looks broken too.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[route] render error', {
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
      <div className="p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-amber-900">This page didn&rsquo;t load</h1>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                Something went wrong rendering this screen. The rest of {brandLabel} is unaffected — you
                can carry on working elsewhere, or try this page again.
              </p>

              {/* The message, not the stack. Enough for a support ticket
                  without putting internals on screen. */}
              <p className="mt-3 rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
                {this.state.error.message || 'Unknown render error'}
              </p>

              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
