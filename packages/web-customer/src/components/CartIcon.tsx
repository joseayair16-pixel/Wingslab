'use client';

type CartIconProps = {
  className?: string;
  strokeWidth?: number;
};

export function CartIcon({ className = 'h-5 w-5', strokeWidth = 2 }: CartIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        d="M3 4h2l.4 2M7 14h10l4-8H5.4M7 14l-1.5 2.5A1 1 0 006.4 18H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}