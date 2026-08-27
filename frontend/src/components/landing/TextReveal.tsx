import { motion, type Variants } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface TextRevealProps {
  text: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  delay?: number;
  once?: boolean;
}

const container: Variants = {
  hidden: {},
  visible: (delay: number) => ({
    transition: { staggerChildren: 0.035, delayChildren: delay },
  }),
};

const wordVariant: Variants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  },
};

/**
 * A heading that reveals a word at a time.
 *
 * THE SPACES BETWEEN WORDS ARE REAL CHARACTERS, and that is the whole point of
 * this comment.
 *
 * The previous version separated words with `marginRight: '0.3em'` on each
 * inline-block span and emitted no whitespace at all. It LOOKED correct and was
 * broken in four ways that only show up off-screen:
 *
 *   · `innerText` returned "Fourthingsstopbeingyourproblem." — so every <h2>
 *     on the landing page indexed as one run-on token, on precisely the element
 *     search engines weight most heavily
 *   · copying a headline pasted it without spaces
 *   · assistive technology has no word boundaries to announce
 *   · the last word carried a trailing 0.3em nobody wanted, and the gap did not
 *     match the font's own word space
 *
 * Rendering `{' '}` between the spans fixes all four: whitespace between
 * inline-blocks collapses to exactly one natural word space, and the animation
 * is unchanged because the spans still animate individually.
 *
 * Under `prefers-reduced-motion` this is a plain heading with plain text — no
 * per-word spans at all, so there is nothing to get wrong.
 */
export default function TextReveal({
  text,
  className = '',
  as = 'h2',
  delay = 0,
  once = true,
}: TextRevealProps) {
  const reduced = usePrefersReducedMotion();
  const Tag = motion[as] as typeof motion.h2;

  if (reduced) {
    const Plain = as;
    return <Plain className={className}>{text}</Plain>;
  }

  const words = text.split(' ');

  return (
    <Tag
      className={className}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount: 0.3 }}
      custom={delay}
      // The accessible name is the whole sentence, so assistive technology
      // never has to reassemble it from the spans below.
      aria-label={text}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden="true">
          <motion.span className="inline-block" variants={wordVariant}>
            {word}
          </motion.span>
          {/* A real space, not a margin. See the note above. */}
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  );
}
