import type { Platform } from '@/lib/domain-types';

/** Inline platform glyphs (docs/11 §2 platform colors). `mono` renders in
 *  currentColor for use on the dark sidebar; otherwise brand-colored. */
export function PlatformIcon({
  platform,
  size = 16,
  mono = false,
}: {
  platform: Platform;
  size?: number;
  mono?: boolean;
}) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true };
  if (platform === 'YOUTUBE') {
    return (
      <svg {...common} fill={mono ? 'currentColor' : '#FF0000'}>
        <path d="M23 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.8-1.8C19.2 5 12 5 12 5s-7.2 0-8.8.5A2.5 2.5 0 0 0 1.4 7.3C1 8.8 1 12 1 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.8 1.8C4.8 19 12 19 12 19s7.2 0 8.8-.5a2.5 2.5 0 0 0 1.8-1.8C23 15.2 23 12 23 12ZM9.8 15.3V8.7l6 3.3-6 3.3Z" />
      </svg>
    );
  }
  if (platform === 'FACEBOOK') {
    return (
      <svg {...common} fill={mono ? 'currentColor' : '#1877F2'}>
        <path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7v-3.5h3.1V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z" />
      </svg>
    );
  }
  // TikTok
  return (
    <svg {...common} fill={mono ? 'currentColor' : '#010101'}>
      <path d="M16.6 5.8a4.8 4.8 0 0 1-1-.1V9a7.9 7.9 0 0 1-4.6-1.5v6.8a5.7 5.7 0 1 1-5.7-5.7c.2 0 .4 0 .6.03v3a2.7 2.7 0 1 0 1.9 2.6V2h2.9a4.8 4.8 0 0 0 4.1 4.7 4.7 4.7 0 0 0 .8.07V5.8Z" />
    </svg>
  );
}
