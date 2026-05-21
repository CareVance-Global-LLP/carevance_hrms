import { motion } from 'framer-motion';

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: SectionHeadingProps) {
  const alignment = align === 'left' ? 'items-start text-left' : 'items-center text-center';
  const descriptionWidth = align === 'left' ? 'max-w-xl' : 'max-w-2xl';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`mx-auto flex max-w-3xl flex-col gap-5 ${alignment}`}
    >
      {eyebrow && (
        <span className="inline-flex items-center rounded-full border border-white/70 bg-white/75 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-700 shadow-[0_10px_35px_-18px_rgba(14,165,233,0.5)] backdrop-blur-xl">
          {eyebrow}
        </span>
      )}
      <div className="space-y-4">
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">
          {title}
        </h2>
        {description && (
          <p className={`${descriptionWidth} text-base leading-8 text-slate-600 sm:text-[1.1rem]`}>
            {description}
          </p>
        )}
      </div>
    </motion.div>
  );
}
