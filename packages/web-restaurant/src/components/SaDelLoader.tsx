'use client';

import { memo, useState } from 'react';
import redWordmark from '../assets/wingslab-wordmark-red.png';
import whiteWordmark from '../assets/wingslab-wordmark-white.png';

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
      className={`wl-restaurant-loader flex flex-col items-center justify-center gap-5 ${
        fullScreen ? 'wl-loader-full min-h-[100dvh] w-full' : ''
      } ${className}`}
      role={fullScreen ? 'status' : undefined}
      aria-live="polite"
    >
      {logoFailed ? (
        <span className={textClass}>WingsLab</span>
      ) : (
        <span className={`wl-loader-brand animate-sadel-breathe ${logoHeightClass}`}>
          <img className="wl-loader-logo-light" src={redWordmark.src} alt="WingsLab" onError={() => setLogoFailed(true)} />
          <img className="wl-loader-logo-dark" src={whiteWordmark.src} alt="" aria-hidden="true" onError={() => setLogoFailed(true)} />
        </span>
      )}
      {label ? (
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      ) : (
        <div
          className="h-1 w-44 overflow-hidden rounded-full bg-neutral-200/90"
          role="progressbar"
          aria-label="Cargando"
        >
          <div className="h-full w-1/3 rounded-full bg-[#f20d12] animate-sadel-progress" />
        </div>
      )}
    </div>
  );
});
