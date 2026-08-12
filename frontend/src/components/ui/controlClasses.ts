/**
 * Shared control styling for buttons and form fields.
 *
 * Lives outside any one page so the signed-out pages, the cookie banner and
 * anything else public stay on the same set. `blue-*` here is not literal blue:
 * `tailwind.config.js` re-points the `blue` ramp at the brand scale, so these
 * render in the product's teal and follow the theme. Raw `sky-*` does not — it
 * is a separate ramp and stays literal sky blue, which is why it should not be
 * used for anything meant to look on-brand.
 */

export const buttonPrimaryClass =
  'group inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-blue-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const buttonSecondaryClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition duration-200 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

export const fieldLabelClass = 'mb-1.5 block text-sm font-medium text-slate-700';

export const fieldInputClass =
  'block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

/** Same, for an input with a leading icon. */
export const fieldInputWithIconClass =
  'block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export const fieldIconClass =
  'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400';
