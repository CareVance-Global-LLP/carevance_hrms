import { FEATURE_MATRIX } from '@/lib/features';

/**
 * The module strip (brief Part 2).
 *
 * A LOGO WALL IS WHAT NORMALLY GOES HERE, AND WE DO NOT HAVE ONE. There are no
 * customers to name yet, and inventing them is the single thing this site is
 * built to never do. What a new entrant honestly has in that slot is scope —
 * so the strip scrolls the ten module names the feature matrix actually
 * defines, read from `FEATURE_MATRIX` rather than typed here. A module cannot
 * appear on this strip without appearing on the comparison table.
 *
 * A SERVER COMPONENT WITH NO JAVASCRIPT AT ALL. Two CSS keyframes and a
 * `:hover` pause; motion would be 45 KB to translate a div, and this one sits
 * high on the page where the budget is tightest.
 *
 * THE LIST IS RENDERED TWICE. A marquee that translates by -50% is seamless
 * only if the second half is a copy of the first; with one copy it snaps back
 * visibly at the loop point. The duplicate is `aria-hidden`, so the strip reads
 * once to a screen reader and the whole thing is `aria-label`led as what it is.
 *
 * Under `prefers-reduced-motion` the animation is switched off in globals.css
 * and the strip becomes an ordinary horizontally-scrollable list — it still
 * says what it says, and nothing moves on its own.
 */
export function ModuleMarquee() {
  const modules = FEATURE_MATRIX.map((c) => c.category);

  return (
    <section
      aria-label="Modules included"
      className="border-y border-n-200 bg-card/60 py-5"
    >
      {/*
        The mask fades both ends rather than cutting them. A marquee that
        terminates on a hard edge reads as clipped content; one that fades reads
        as continuing past the viewport, which is what it is doing.
      */}
      <div
        className="marquee-mask group relative flex overflow-hidden"
        style={{ ['--marquee-duration' as string]: '38s' }}
      >
        {[false, true].map((isClone) => (
          <ul
            key={String(isClone)}
            aria-hidden={isClone || undefined}
            className="marquee-track flex shrink-0 items-center gap-3 pr-3"
          >
            {modules.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-full border border-n-200 bg-card px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap text-n-700"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                {name}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}
