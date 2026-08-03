import { type ReactNode } from 'react';

interface MarqueeProps {
  children: ReactNode[];
  className?: string;
  speed?: number;
  pauseOnHover?: boolean;
}

export default function Marquee({
  children,
  className = '',
  speed = 30,
  pauseOnHover = true,
}: MarqueeProps) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div
        className="flex gap-8"
        style={{
          width: 'fit-content',
          animation: `marquee ${speed}s linear infinite`,
        }}
        onMouseEnter={(e) => {
          if (pauseOnHover) {
            (e.currentTarget as HTMLElement).style.animationPlayState = 'paused';
          }
        }}
        onMouseLeave={(e) => {
          if (pauseOnHover) {
            (e.currentTarget as HTMLElement).style.animationPlayState = 'running';
          }
        }}
      >
        {/* First set */}
        {children.map((child, i) => (
          <div key={`a-${i}`} className="flex-shrink-0">
            {child}
          </div>
        ))}
        {/* Duplicate for seamless loop */}
        {children.map((child, i) => (
          <div key={`b-${i}`} className="flex-shrink-0">
            {child}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
