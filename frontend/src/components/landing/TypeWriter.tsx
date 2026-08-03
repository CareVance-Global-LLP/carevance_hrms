import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

interface TypeWriterProps {
  text: string;
  speed?: number;
  className?: string;
  cursor?: boolean;
  delay?: number;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
}

export default function TypeWriter({
  text,
  speed = 50,
  className = '',
  cursor = true,
  delay = 0,
  as: Tag = 'span',
}: TypeWriterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [displayed, setDisplayed] = useState('');
  const [showCursor, setShowCursor] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isInView) return;

    const startTimeout = setTimeout(() => {
      setShowCursor(true);
      let i = 0;
      const interval = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, i + 1));
          i++;
        } else {
          clearInterval(interval);
          setTimeout(() => setDone(true), 800);
        }
      }, speed);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(startTimeout);
  }, [isInView, text, speed, delay]);

  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={className}>
      {displayed}
      {cursor && showCursor && !done && (
        <span className="ml-0.5 inline-block w-[2px] animate-pulse bg-current align-middle" style={{ height: '1em' }} />
      )}
    </Tag>
  );
}
