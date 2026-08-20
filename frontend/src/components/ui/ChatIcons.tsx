interface SparkleMarkProps {
  size?: number;
  className?: string;
}

/**
 * The assistant's mark: a four-point star, drawn in currentColor.
 *
 * It used to arrive baked into a circle filled with a literal #5D969D, which
 * meant the one piece of brand furniture in the assistant could not follow a
 * theme change — and nested awkwardly when the tile around it was already a
 * rounded square. The mark is now just the star; the surface under it is the
 * tile's job.
 */
export function SparkleMark({ size = 24, className = '' }: SparkleMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M28 6 Q30.5 25.5 50 28 Q30.5 30.5 28 50 Q25.5 30.5 6 28 Q25.5 25.5 28 6 Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface SparkleTileProps {
  size?: number;
  radius?: string;
  className?: string;
  testId?: string;
}

/**
 * The mark on its brand ground. One tile at three sizes — the launcher, the
 * panel header, and the avatar beside every reply — so the thing you tap and
 * the thing that answers you are visibly the same object.
 *
 * `cta-band` rather than a brand-ramp utility: the ramp inverts, so
 * `from-primary-500` turns pale in dark mode and takes the white mark with it.
 * See the .cta-band comment in styles/theme.css.
 */
export function SparkleTile({ size = 40, radius = 'rounded-xl', className = '', testId }: SparkleTileProps) {
  return (
    <span
      data-testid={testId}
      className={`cta-band inline-flex shrink-0 items-center justify-center ${radius} text-white ${className}`}
      style={{ width: size, height: size }}
    >
      <SparkleMark size={Math.round(size * 0.58)} />
    </span>
  );
}

interface BotAvatarProps {
  className?: string;
}

/**
 * The assistant's face, in the app and on the marketing pages alike.
 *
 * This was two components — DefaultBotAvatar tinted bg-emerald-50 and
 * LandingBotAvatar tinted bg-accent-100 — which made the same assistant look
 * like two different products depending on which page you met it on.
 */
export function BotAvatar({ className = '' }: BotAvatarProps) {
  return <SparkleTile size={24} radius="rounded-lg" className={className} testId="chat-bot-avatar" />;
}

interface HeadsetIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function HeadsetIcon({ size = 64, color = '#5B9B8E', className = '' }: HeadsetIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M16 28C16 18.059 24.059 10 34 10h-4C19.059 10 11 18.059 11 28v2c0 5.523 4.477 10 10 10h0c2.761 0 5-2.239 5-5v-7"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M48 28c0-9.941-8.059-18-18-18h4c9.941 0 18 8.059 18 18v2c0 5.523-4.477 10-10 10h0c-2.761 0-5-2.239-5-5v-7"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect x="8" y="26" width="7" height="12" rx="3.5" fill={color} />
      <rect x="49" y="26" width="7" height="12" rx="3.5" fill={color} />
      <path d="M8 35c0 3 2 5 5 5h3" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="42" r="3" fill={color} />
      <path
        d="M32 18c-9.941 0-18 7.163-18 16s8.059 16 18 16c2.13 0 4.17-.33 6.07-.94L42 54l-2.73-6.14C44.76 45.63 46 42.47 46 39c0-8.837-8.059-16-18-16h4z"
        fill="#E8B96B"
      />
      <ellipse cx="32" cy="34" rx="10" ry="9" fill="#D89B3C" />
      <circle cx="28" cy="33" r="2" fill={color} />
      <circle cx="36" cy="33" r="2" fill={color} />
      <path d="M28 38c1.5 2 4.5 2 6 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
