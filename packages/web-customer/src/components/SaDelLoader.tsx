'use client';

import { memo, useState } from 'react';

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

  const logoHeight = size === 'sm' ? 28 : size === 'lg' ? 64 : 44;
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
    >
      {logoFailed ? (
        <span className={textClass}>SaDeL</span>
      ) : (
        <img
          src="/SaDeL.png"
          alt="SaDeL"
          width={400}
          height={103}
          onError={() => setLogoFailed(true)}
          className="sadel-loader-logo animate-sadel-breathe select-none pointer-events-none"
          style={{ height: logoHeight, width: 'auto' }}
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
