'use client';
import { type SVGProps } from 'react';

export function Scooter(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="5.5" cy="16.5" r="2.3" />
      <circle cx="18.5" cy="16.5" r="2.3" />
      <path d="M7.6 16.5 H11" />
      <path d="M11 16.5 V13 Q11 11 13.5 11 H16.5 V16.5" />
      <path d="M13.5 11 H17" />
      <path d="M7.6 16.5 L9 8.6 H12" />
      <path d="M12 8.6 L13.7 6.4" />
      <path d="M13.7 6.4 H15.8" />
      <circle cx="9" cy="8.6" r="0.9" />
    </svg>
  );
}
