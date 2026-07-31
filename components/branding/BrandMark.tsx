'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/** App mark — snowflake on warm amber gradient (matches app/icon.svg). */
export function BrandMark({ className }: { className?: string }) {
  const gradId = `brand-mark-g-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0A05A" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gradId})`} />
      <g fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round">
        <path d="M16 7v18M7 16h18" />
        <path d="M9.5 9.5l13 13M22.5 9.5l-13 13" />
        <path d="M16 10.2l2.2-2.2M16 10.2l-2.2-2.2M16 21.8l2.2 2.2M16 21.8l-2.2 2.2" />
        <path d="M10.2 16l-2.2 2.2M10.2 16l-2.2-2.2M21.8 16l2.2 2.2M21.8 16l2.2-2.2" />
      </g>
    </svg>
  );
}
