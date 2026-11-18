'use client';

import { memo } from 'react';
import redWordmark from '../assets/wingslab-wordmark-red.png';

export const SaDelLoader = memo(function SaDelLoader({
  className = '',
  label,
  size = 'md',
  fullScreen = false,
}: {
  className?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
}) {
  const logoHeightClass = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-16' : 'h-11';

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullScreen ? 'min-h-[100dvh] w-full' : ''
      } ${className}`}
      role={fullScreen ? 'status' : undefined}
      aria-live="polite"
    >
      <img
        src={redWordmark.src}
        alt="WingsLab"
        className={`sadel-loader-logo animate-sadel-breathe select-none pointer-events-none ${logoHeightClass} w-auto`}
      />
      {label ? (
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      ) : (
        <div
          className="h-1 w-44 overflow-hidden rounded-full bg-neutral-200/90"
          role="progressbar"
          aria-label="Cargando"
        >
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#f20d12] to-[#a8070b] animate-sadel-progress" />
        </div>
      )}
    </div>
  );
});
