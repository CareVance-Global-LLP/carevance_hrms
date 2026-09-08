/**
 * The change AI mode is proposing, and the one button that makes it real.
 *
 * The rule the read path carries is "never invent a number". The rule here is
 * **never act on an interpretation the person has not seen**, and this
 * component is the seeing. Four things follow from that and none of them is
 * cosmetic:
 *
 *  - **Nothing here is computed.** Every `from`, every `to` and the impact
 *    sentence are the server's, rendered as returned. `from` was read off the
 *    live row when the preview was built and the token was signed over it, so a
 *    value derived on this side would be a second opinion sitting beside the
 *    one the write will actually be checked against.
 *  - **The preview IS the confirmation surface.** No dialog. The command bar's
 *    portal sits at `z-[200]` while every Modal renders at `50 + depth * 10`,
 *    so a ConfirmDialog opened from in here would render behind the palette's
 *    own backdrop and be unclickable — and stacking a second "are you sure"
 *    on top of a diff somebody has just read is a click that asks nothing new.
 *  - **No token, no button.** A preview whose diff is empty comes back with
 *    `token: null` and a sentence saying what the row already holds. Offering
 *    Apply anyway ends in "that preview has expired" for a change that was
 *    never needed.
 *  - **A refusal keeps the diff on screen.** The person needs to see what was
 *    refused, and — for a stale row especially — the numbers that moved under
 *    them. Blanking the panel would leave them with a sentence and no subject.
 *    What a STALE refusal does withdraw is the Apply button: the diff above it
 *    is now a claim about a row that has moved, so the button no longer means
 *    what it says, and "Ask again" takes its place.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ActResponse, ActRefusal, AskAction } from '@/services/api';

/**
 * A refusal from `/search/act`, carried as an Error so it travels through the
 * promise `onApply` returns.
 *
 * The SENTENCE is the server's, verbatim, and stays that way all the way to the
 * screen: it names what was actually wrong with THIS row — "Carry-forward cap
 * is now 7, not 5" — and paraphrasing it here would trade a fact for a
 * category. `refusal` is the machine code beside it, and it exists so the card
 * can offer the right next step without parsing English to find one.
 */
export class ActionRefusedError extends Error {
  constructor(
    message: string,
    public readonly refusal: ActRefusal | null,
  ) {
    super(message);
    this.name = 'ActionRefusedError';
  }
}

/**
 * Refusals that make the preview itself wrong rather than merely refused.
 *
 * `stale` means the row moved under the diff; `no_preview` means the token is
 * expired, tampered or was issued to somebody else. Neither can be retried into
 * a success, so offering Apply again would be offering a button that is
 * guaranteed to refuse.
 */
const PREVIEW_IS_WRONG_NOW: ActRefusal[] = ['stale', 'no_preview'];

export interface AiActionPreviewProps {
  action: AskAction;
  /**
   * Posts the token to /search/act. Rejects with an `ActionRefusedError`
   * carrying the server's own sentence.
   */
  onApply: (token: string) => Promise<ActResponse>;
  /** Discards the preview without applying it. Nothing was written. */
  onCancel?: () => void;
  /** Re-runs the original question, for a preview that is no longer true. */
  onReask?: () => void;
}

/** A value as a person reads it. Null is "nothing", never an empty cell. */
function render(value: string | number | null): string {
  if (value === null || value === '') return 'nothing';
  return String(value);
}

export default function AiActionPreview({
  action,
  onApply,
  onCancel,
  onReask,
}: AiActionPreviewProps) {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ActResponse | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [refusalCode, setRefusalCode] = useState<ActRefusal | null>(null);

  const appliedRef = useRef<HTMLDivElement | null>(null);
  const reaskRef = useRef<HTMLButtonElement | null>(null);

  /*
   * A new preview is a new decision. Without this, applying one change and then
   * asking for another would leave the previous "Applied" tick sitting under a
   * diff that has not been applied at all — which reads as though it had.
   */
  useEffect(() => {
    setApplying(false);
    setApplied(null);
    setRefusal(null);
    setRefusalCode(null);
  }, [action.token, action.key]);

  const staleNow = refusalCode !== null && PREVIEW_IS_WRONG_NOW.includes(refusalCode);

  /*
   * FOCUS FOLLOWS THE BUTTON THAT REPLACED IT.
   *
   * Both outcomes below unmount Apply while a keyboard user is standing on it,
   * and an unmounted focused element drops focus to <body> — which costs them
   * their place in the palette and reads as the panel having closed. So focus
   * moves to whatever took its slot: the applied notice and its link, or the
   * Ask again button.
   */
  useEffect(() => {
    if (applied) appliedRef.current?.focus();
  }, [applied]);

  useEffect(() => {
    if (staleNow) reaskRef.current?.focus();
  }, [staleNow]);

  const apply = async () => {
    if (!action.token || applying) return;

    setApplying(true);
    setRefusal(null);
    setRefusalCode(null);

    try {
      setApplied(await onApply(action.token));
    } catch (error) {
      // Only success clears the button. A refused Apply that hid its own
      // control would leave somebody unable to retry after fixing the cause —
      // unless the refusal was that the preview itself is now wrong, which
      // `staleNow` handles by swapping Apply for Ask again.
      setRefusal(error instanceof Error ? error.message : 'That change could not be applied.');
      setRefusalCode(error instanceof ActionRefusedError ? error.refusal : null);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="px-4 py-4" data-testid="ai-action-preview">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{action.label}</p>
      </div>

      <p className="mt-1 text-sm font-semibold text-slate-900">{action.target.label}</p>

      {action.changes.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {action.changes.map((change) => (
            <div
              key={change.field}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <dt className="text-xs font-medium text-slate-600">{change.label}</dt>
              {/*
                THE DIRECTION IS SPOKEN, NOT ONLY DRAWN.

                An arrow glyph and a strike-through are the whole of the
                direction for a sighted reader, and neither reaches a screen
                reader: the icon is `aria-hidden` and `line-through` is CSS.
                Announced as "Annual quota 12 14 days", this card asked a blind
                admin to consent to a write without ever saying which number the
                row holds today — on the one surface whose entire job is consent.

                So `<del>`/`<ins>` carry the semantics and a visually-hidden
                "from"/"to" carries the words, because support for those two
                elements is uneven enough that neither is worth relying on
                alone. It now reads "Annual quota from 12 to 14 days".
              */}
              <dd className="flex items-baseline gap-2 text-sm text-slate-900">
                <del className="text-slate-600 line-through">
                  <span className="sr-only">from </span>
                  {render(change.from)}
                </del>
                <ArrowRight className="h-3 w-3 shrink-0 self-center text-slate-600" aria-hidden="true" />
                <ins className="font-semibold no-underline">
                  {/* Spaced on BOTH sides: the elements sit flush in the DOM,
                      so "from 5" and "to 10" would otherwise run together. */}
                  <span className="sr-only">{' to '}</span>
                  {render(change.to)}
                  {change.unit ? ` ${change.unit}` : ''}
                </ins>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/*
        Fields that already hold what was asked for. Shown rather than dropped:
        silently omitting one leaves the reader unsure it was understood at all.
      */}
      {action.unchanged.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Already set:{' '}
          {action.unchanged.map((held) => `${held.label} ${render(held.value)}`).join(', ')}
        </p>
      )}

      {/* A count, and only ever a count — a preview is not a directory export. */}
      <p className="mt-3 text-xs text-slate-600">{action.impact}</p>

      {action.message && !applied && (
        <p className="mt-3 text-sm text-slate-900">{action.message}</p>
      )}

      {/*
        A REFUSAL IS ANNOUNCED, because it is the outcome that most needs to be.

        Applying succeeds into a `role="status"` notice and moves focus to it;
        a refusal used to re-enable the button and print a sentence, and
        nothing else — so the one case where nothing happened was the only one
        a screen reader could not tell apart from success. `role="alert"`
        interrupts, which is right here: the person is standing on Apply
        waiting to learn whether the change went through.
      */}
      {refusal && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded border border-amber-400/30 bg-amber-50 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-xs text-slate-900">{refusal}</p>
        </div>
      )}

      {applied ? (
        /*
          `tabIndex={-1}` so focus can be moved here when Apply unmounts under
          it — not to put it in the tab order, which would make a notice a stop
          on the way to the link that follows it.
        */
        <div
          ref={appliedRef}
          tabIndex={-1}
          role="status"
          className="mt-3 flex flex-wrap items-center gap-2 outline-none"
        >
          <Check className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="text-sm text-slate-900">{applied.message}</p>
          {/*
            The second half of "change this, then open it for me". The route is
            the server's — the action's own view_route — so the link goes where
            the change actually landed rather than where this side guessed.
          */}
          {applied.route && (
            <Link
              to={applied.route}
              className="rounded text-sm font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              View it
            </Link>
          )}
        </div>
      ) : (
        action.token && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/*
              APPLY BEFORE CANCEL IN THE DOM, and in that order on screen, so
              the tab order and the reading order are the same one. The card is
              the first thing after the input row, which puts the primary action
              two stops from the field the question was typed in — past the AI
              toggle that sits beside it, and past nothing else.
            */}
            {staleNow ? (
              <button
                ref={reaskRef}
                type="button"
                onClick={onReask}
                className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-1.5 text-sm font-semibold text-on-brand transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Ask again
              </button>
            ) : (
              <button
                type="button"
                onClick={apply}
                disabled={applying}
                className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-1.5 text-sm font-semibold text-on-brand transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-60"
              >
                {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {applying ? 'Applying…' : 'Apply'}
              </button>
            )}

            {/*
              Cancel is a real control, not a hint to press Escape. Escape here
              closes the whole palette, and somebody who wants to drop ONE
              proposed change should not have to throw away the session to do
              it.
            */}
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="inline-flex items-center rounded border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-60"
            >
              Cancel
            </button>

            {/*
              Said out loud rather than assumed. It stays true after a refusal
              too: nothing on the write path half-applies, so a refused Apply
              has changed exactly as much as an unclicked one.
            */}
            <span className="text-xs text-slate-600">Nothing has changed yet.</span>
          </div>
        )
      )}
    </div>
  );
}
