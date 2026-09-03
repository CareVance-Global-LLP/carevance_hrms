import { assistantLabel, supportEmail } from '@/config/brand';
/**
 * The one visual identity shared by both assistant bubbles.
 *
 * There are two of them — AdminChatBubble inside the app, LandingPageChatBubble
 * on the marketing pages — and they had drifted into two different-looking
 * widgets: a bare circle against a rounded square, a flat header against a
 * gradient, two differently-tinted bot avatars, and two accent steps off the
 * same brand ramp. They are one product speaking in two places, so the chrome
 * lives here and neither component hardcodes it.
 *
 * What legitimately differs stays in the components: the admin bubble drags and
 * renders source links, the landing bubble pins to the corner and renders a
 * trial CTA. Chrome is shared; behaviour is not.
 *
 * chatBubbleParity.test.tsx fails if either component stops using these.
 */

/*
 * A note on why almost nothing here uses the brand ramp directly.
 *
 * `primary`/`blue`/`slate` are re-pointed at CSS-var ramps that INVERT in dark
 * mode, so `bg-primary-500` is a deep teal in light and a pale one in dark.
 * Anything carrying white text on a brand fill therefore has to use `cta-band`
 * (deep in both themes) or pair the fill with `text-on-brand`, which inverts
 * with it. The header and the user bubble both got this wrong and turned into
 * white-on-pale in dark mode. styles/theme.css documents the same trap on
 * `.cta-band` itself.
 */

/** Floating launcher: the mark on its own tile, so the thing you tap is the
 *  same object that answers you. The ring keeps its edge on any background. */
export const CHAT_LAUNCHER_CLASS =
  'cta-band group fixed z-[100] flex h-14 w-14 items-center justify-center rounded-2xl text-white ring-1 ring-black/5 shadow-lg shadow-black/20 transition-transform duration-200 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 select-none touch-none motion-reduce:transition-none motion-reduce:hover:scale-100';

/** Panel shell. Components append their own positioning, which differs: the
 *  admin panel follows the draggable launcher, the landing panel is pinned. */
/*
 * `max-md:inset-0` goes full-bleed on small screens, but both panels also cap
 * their width at 360px — so between the two rules the panel came out 360 wide
 * and full height, pinned to the left edge with the page showing beside it.
 * The width cap has to be lifted in the same breakpoint that pins the edges.
 */
export const CHAT_PANEL_CLASS =
  'chat-panel-enter fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-surface-card shadow-2xl shadow-black/25 max-md:inset-0 max-md:w-full max-md:max-w-none max-md:rounded-none';

/** Deep brand ground, plus a single gold hairline at its base. Gold appears
 *  exactly once in the panel — as a rule, not as half the surface. The old
 *  teal-to-gold gradient washed out to olive in dark mode and took the white
 *  title with it. */
export const CHAT_HEADER_CLASS =
  'cta-band flex items-center justify-between gap-3 border-b-2 border-accent-500 px-3.5 py-3 text-white';

/** Message bubbles. `text-on-brand` on the user bubble, not `text-white`:
 *  the fill inverts in dark mode and the label has to invert with it. */
export const CHAT_USER_BUBBLE_CLASS =
  'rounded-2xl rounded-br-md bg-primary-600 px-3 py-2 text-[13px] leading-[1.55] text-on-brand';
export const CHAT_ASSISTANT_BUBBLE_CLASS =
  'rounded-2xl rounded-bl-md border border-black/5 bg-surface-raised px-3 py-2 text-[13px] leading-[1.55] text-slate-700 shadow-sm';

/** Suggestion / quick-question chips. */
export const CHAT_CHIP_CLASS =
  'rounded-full border border-slate-200 bg-surface-card px-2.5 py-1.5 text-[11px] font-medium leading-none text-slate-600 transition hover:border-primary-400 hover:bg-primary-500/10 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

/** Footer strips (quick questions, CTA, composer). */
export const CHAT_FOOTER_CLASS = 'border-t border-black/5 bg-surface-card';

/** The transcript sits lower than the panel so the reply cards lift off it. */
export const CHAT_TRANSCRIPT_CLASS = 'flex-1 space-y-3 overflow-y-auto bg-surface-sunken px-3 py-3';

/** Small uppercase label above the chip rows and the source links. */
export const CHAT_EYEBROW_CLASS =
  'text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400';

/** Composer input and send button. Disabled send drops to a flat surface
 *  rather than a dimmed brand circle, which read as a broken control. */
export const CHAT_INPUT_CLASS =
  'min-h-[2.25rem] flex-1 rounded-xl border border-slate-200 bg-surface-sunken px-3 py-2 text-[13px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/25';
export const CHAT_SEND_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-on-brand transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:bg-surface-sunken disabled:text-slate-400 disabled:hover:bg-surface-sunken';

/** Typing indicator dot. */
export const CHAT_DOT_CLASS = 'h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 motion-reduce:animate-none';

/** One name, in both places. The two bots have different jobs but they are the
 *  same assistant as far as anyone looking at them is concerned.
 *
 *  The subtitle is NOT shared: it names what this particular assistant does,
 *  which is the one thing about them that genuinely differs. "Always here to
 *  help" said nothing in either place. */
export const CHAT_ASSISTANT_NAME = assistantLabel;

export const CHAT_DISCLAIMER = 'AI may be inaccurate. Verify important info.';
export const CHAT_SUPPORT = { email: supportEmail, phone: '+91 800-123-4567' };
