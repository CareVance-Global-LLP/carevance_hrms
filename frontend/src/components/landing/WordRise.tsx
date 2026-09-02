import { motion } from 'framer-motion';
import { easeOut } from './animations';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The headline phrase, rising a word at a time.
 *
 * THIS REPLACED A TYPEWRITER, and the reasons are worth keeping written down
 * because typewriters look impressive in a demo and cost real money in
 * production:
 *
 *   · It delayed the LCP element. The hero h1 is the largest contentful paint,
 *     and a typewriter means the text does not exist yet — the metric cannot be
 *     recorded until the last character lands. At 55ms per character that
 *     phrase took roughly a second before it had even started.
 *   · It is worse on every repeat visit. A returning reader watches the same
 *     sentence get typed out again before they can read it.
 *   · The DOM contained a partial sentence, so a crawler could index
 *     "team is worki".
 *
 * The word rise costs none of that: the complete phrase is in the DOM from the
 * first render, the words only translate and fade, and the whole thing is done
 * in ~0.5s. `aria-label` carries the sentence so a screen reader gets one
 * phrase rather than a list of words.
 *
 * Under `prefers-reduced-motion` this is a plain span with the text in it.
 */
export default function WordRise({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  /** Seconds before the first word moves. */
  delay?: number;
}) {
  const reduced = usePrefersReducedMotion();

  if (reduced) return <span className={className}>{text}</span>;

  const words = text.split(' ');

  return (
    <span className={className}>
      {/*
        NO sr-only DUPLICATE AND NO aria-hidden, BECAUSE THE SPACES ARE REAL.
        ──────────────────────────────────────────────────────────────────────
        An earlier version hid these spans from assistive technology and carried
        a second, visually-hidden copy of the sentence for it to read. That was
        only ever a workaround for words separated by `margin` with no space
        character, and it cost a real defect: `innerText` held the sentence
        TWICE, so copying a headline pasted it twice and prices rendered as
        "₹399₹399".

        (`aria-label` on this span is not the alternative — a bare <span> is
        role=generic, which prohibits naming.)

        With a genuine space between the spans none of that is needed: inline
        elements separated by whitespace are announced as continuous text, so
        the markup is simply correct rather than corrected.
      */}
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          // The mask each word rises out of. Without `overflow-hidden` the word
          // slides over the line above it instead of emerging from its own.
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
        >
          <motion.span
            className="inline-block"
            initial={{ y: '0.9em', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.38, delay: delay + i * 0.07, ease: easeOut }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </span>
  );
}
