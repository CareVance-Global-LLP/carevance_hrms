/**
 * What AI mode shows while it is working.
 *
 * The old state was three grey pulsing bars, which say "something is loading"
 * and nothing else. A question here takes roughly three seconds and passes
 * through distinct stages, and three seconds of silence reads as a hang — so
 * the wait says what is happening rather than merely that something is.
 *
 * THE STAGES ARE REAL, NOT DECORATION. They match what the server actually
 * does: pick the entities the question is about, ask the model for a plan,
 * then run that plan against the database. Timings come from measurement —
 * retrieval is local and instant, planning is the ~3s model call, execution is
 * a single query. Inventing a progress bar that moves at a rate unrelated to
 * the work is worse than none, because it teaches people to distrust it.
 *
 * If the answer takes longer than the stages do, the last one stays and keeps
 * animating. It never claims to be finished while it is still waiting.
 */

import { useEffect, useState } from 'react';
import { Database, Sparkles, Table2 } from 'lucide-react';

/**
 * Elapsed milliseconds at which each stage becomes the current one. Measured
 * against production: retrieval is local, the planner call is ~2.5-3.5s, and
 * execution is one query.
 */
const STAGES = [
  { at: 0, icon: Sparkles, label: 'Reading your question' },
  { at: 600, icon: Database, label: 'Working out which data to look at' },
  { at: 2400, icon: Table2, label: 'Running the query' },
] as const;

export default function AiThinking() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 200);
    return () => window.clearInterval(timer);
  }, []);

  // The last stage whose threshold has passed — never past the end, so a slow
  // answer sits on "Running the query" rather than falling off the list.
  const index = STAGES.reduce((best, stage, i) => (elapsed >= stage.at ? i : best), 0);
  const { icon: Icon, label } = STAGES[index];

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-4 py-10"
      role="status"
      /*
       * `status` does not take its name from content, so without this the
       * region is nameless — and the whole point of a live region is that it
       * can be found and announced.
       *
       * The label does NOT suppress the stage text: aria-live announces
       * CONTENT changes, so a screen reader user hears "Working out which data
       * to look at" as the stage advances, which is the same information the
       * visual carries. Polite, so it never interrupts.
       */
      aria-label="Working out the answer"
      aria-live="polite"
    >
      {/*
        The same rotating conic sweep as the panel's border, at a smaller
        radius. Reusing it ties the wait to the mode it belongs to instead of
        introducing a second visual language for "AI is busy".
      */}
      <span className="ai-thinking-orb" aria-hidden="true">
        <Icon className="h-4 w-4 text-blue-700" />
      </span>

      <span className="text-sm font-medium text-slate-700">{label}</span>

      {/*
        Three dots that fill in sequence — one per stage, so the row doubles as
        a position indicator. Filled means passed, not "loading".
      */}
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {STAGES.map((stage, i) => (
          <span
            key={stage.at}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              i <= index ? 'bg-blue-600' : 'bg-slate-200'
            }`}
          />
        ))}
      </span>
    </div>
  );
}
