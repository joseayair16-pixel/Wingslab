import type { CSSProperties } from 'react';
export function WingsLabLogo({ className = '', style }: { className?: string; style?: CSSProperties; onError?: () => void }) {
  return <svg role="img" aria-label="WingsLab" viewBox="0 0 220 48" className={className} style={style}>
    <rect x="1" y="3" width="42" height="42" rx="13" fill="#ea580c" />
    <path d="m10 17 5 17 7-12 7 12 5-17" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <text x="53" y="34" fill="currentColor" fontFamily="system-ui,sans-serif" fontWeight="800" fontSize="29" letterSpacing="-1">WingsLab</text>
  </svg>;
}
