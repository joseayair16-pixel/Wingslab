'use client';

import { memo, useState } from 'react';
import { SaDelLogo } from './SaDelLogo';

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
  const [logoFailed, setLogoFailed] = useState(false);

  const logoHeightClass = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-16' : 'h-11';
  const textClass =
    size === 'sm'
      ? 'text-xl font-black tracking-tight text-neutral-900'
      : size === 'lg'
        ? 'text-4xl font-black tracking-tight text-neutral-900'
        : 'text-3xl font-black tracking-tight text-neutral-900';

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullScreen ? 'min-h-[100dvh] w-full' : ''
      } ${className}`}
      role={fullScreen ? 'status' : undefined}
      aria-live="polite"
    >
      {logoFailed ? (
        <span className={textClass}>SaDeL</span>
      ) : (
        <SaDelLogo
          onError={() => setLogoFailed(true)}
          className={`sadel-loader-logo animate-sadel-breathe select-none pointer-events-none ${logoHeightClass} w-auto`}
        />
      )}
      {label ? (
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      ) : (
        <div
          className="h-1 w-44 overflow-hidden rounded-full bg-neutral-200/90"
          role="progressbar"
          aria-label="Cargando"
        >
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 animate-sadel-progress" />
        </div>
      )}
    </div>
  );
});
