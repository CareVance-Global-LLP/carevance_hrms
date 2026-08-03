import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

interface TextScrambleProps {
  text: string;
  className?: string;
  speed?: number;
  delay?: number;
  scrambleChars?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
}

const CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export default function TextScramble({
  text,
  className = '',
  speed = 30,
  delay = 0,
  scrambleChars = CHARS,
  as: Tag = 'span',
}: TextScrambleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(text.replace(/./g, ' '));
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (!isInView || hasStarted) return;
    setHasStarted(true);

    const timeout = setTimeout(() => {
      let iteration = 0;
      const maxIterations = text.length;
      const interval = setInterval(() => {
        setDisplay(
          text
            .split('')
            .map((char, index) => {
              if (char === ' ') return ' ';
              if (index < iteration) return text[index];
              return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
            })
            .join('')
        );

        iteration += 1 / 3;

        if (iteration >= maxIterations) {
          clearInterval(interval);
          setDisplay(text);
        }
      }, speed);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, [isInView, text, speed, delay, scrambleChars, hasStarted]);

  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={className}>
      {display}
    </Tag>
  );
}
