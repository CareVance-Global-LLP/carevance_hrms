interface SparkleIconProps {
  size?: number;
  className?: string;
}

export function SparkleIcon({ size = 56, className = '' }: SparkleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="28" cy="28" r="26" fill="#5D969D" />
      <path
        d="M28 10 Q30 28 46 28 Q28 30 28 46 Q26 28 10 28 Q28 26 28 10 Z"
        fill="white"
      />
    </svg>
  );
}

interface DefaultBotAvatarProps {
  className?: string;
}

export function DefaultBotAvatar({ className = '' }: DefaultBotAvatarProps) {
  return (
    <div
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius)] bg-emerald-50 ${className}`}
    >
      <SparkleIcon size={16} />
    </div>
  );
}

interface LandingBotAvatarProps {
  className?: string;
}

export function LandingBotAvatar({ className = '' }: LandingBotAvatarProps) {
  return (
    <div
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius)] bg-accent-100 ${className}`}
    >
      <SparkleIcon size={16} />
    </div>
  );
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
