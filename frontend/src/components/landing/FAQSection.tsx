import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { pricingFaqs } from '@/constants/pricing';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Shared by the homepage and /pricing, which ask different questions.
 *
 * The defaults are the billing FAQ, so /pricing keeps working untouched; the
 * homepage passes the eight buyer objections from landingFaqs.ts. Answers are
 * NOT duplicated here — whatever is passed in is also what gets emitted as
 * FAQPage structured data by the caller, so the two can never disagree.
 */
export default function FAQSection({
  items = pricingFaqs,
  eyebrow = 'FAQ',
  title = 'Frequently asked questions',
  description = 'Quick answers about trials, billing, onboarding, and team management.',
}: {
  items?: readonly FaqItem[];
  eyebrow?: string;
  title?: string;
  description?: string;
} = {}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);
  const reduced = usePrefersReducedMotion();

  return (
    <section id="faq" className="bg-surface-sunken px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            {eyebrow}
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            {title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            {description}
          </motion.p>
        </div>

        {/* FAQ items */}
        <div className="mt-10 space-y-2">
          {items.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <motion.div
                key={item.question}
                initial={reduced ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }
                }
                className={`overflow-hidden rounded-lg border transition-all duration-300 ${
                  isOpen ? 'border-blue-200 bg-white shadow-sm' : 'border-slate-200 bg-white shadow-sm hover:border-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold text-slate-900">{item.question}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="shrink-0"
                  >
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="answer"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={
                        reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }
                      }
                      className="overflow-hidden"
                    >
                      <div className="border-t border-slate-100 px-5 pb-5 pt-3">
                        <p className="text-sm leading-7 text-slate-500">{item.answer}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
