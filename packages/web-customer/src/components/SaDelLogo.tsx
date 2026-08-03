'use client';

import { memo, useEffect, useState } from 'react';

/**
 * SaDelLogo – Advanced Canvas Processor
 * Solves the dark mode inversion problem by generating two perfect transparent PNGs:
 * 1. Light Mode: Pure black text, original blue accents, clean alpha channel.
 * 2. Dark Mode: Pure white text, original blue accents, clean alpha channel.
 */

let cachedLightSrc: string | null = null;
let cachedDarkSrc: string | null = null;
let processingPromise: Promise<{ light: string; dark: string }> | null = null;

function processLogo(): Promise<{ light: string; dark: string }> {
  if (cachedLightSrc && cachedDarkSrc) {
    return Promise.resolve({ light: cachedLightSrc, dark: cachedDarkSrc });
  }
  if (processingPromise) return processingPromise;

  processingPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ light: '/SaDeL.png', dark: '/SaDeL.png' });
        return;
      }

      ctx.drawImage(img, 0, 0);
      const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      const lightData = new ImageData(new Uint8ClampedArray(originalData.data), canvas.width, canvas.height);
      const darkData = new ImageData(new Uint8ClampedArray(originalData.data), canvas.width, canvas.height);

      for (let i = 0; i < originalData.data.length; i += 4) {
        const r = originalData.data[i];
        const g = originalData.data[i + 1];
        const b = originalData.data[i + 2];

        // Detect if pixel is part of the sky blue accents
        const isBlue = b > r + 20 && b > g + 10;

        if (isBlue) {
          // Keep original blue pixels fully opaque
          lightData.data[i + 3] = 255;
          darkData.data[i + 3] = 255;
        } else {
          // Process grayscale text and motorcycle
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          
          // Extract alpha based on how dark the pixel is
          let alpha = 255 - luminance;
          if (luminance > 240) alpha = 0; // Pure white becomes fully transparent
          else if (luminance < 20) alpha = 255; // Pure black becomes fully opaque

          // Light mode: Solid black text with precise alpha blending
          lightData.data[i] = 0;
          lightData.data[i + 1] = 0;
          lightData.data[i + 2] = 0;
          lightData.data[i + 3] = alpha;

          // Dark mode: Solid white text with slightly boosted alpha for crispness
          darkData.data[i] = 255;
          darkData.data[i + 1] = 255;
          darkData.data[i + 2] = 255;
          darkData.data[i + 3] = Math.min(255, alpha * 1.5);
        }
      }

      ctx.putImageData(lightData, 0, 0);
      const lightSrc = canvas.toDataURL('image/png');

      ctx.putImageData(darkData, 0, 0);
      const darkSrc = canvas.toDataURL('image/png');

      cachedLightSrc = lightSrc;
      cachedDarkSrc = darkSrc;
      resolve({ light: lightSrc, dark: darkSrc });
    };
    img.onerror = () => resolve({ light: '/SaDeL.png', dark: '/SaDeL.png' });
    img.src = '/SaDeL.png';
  });

  return processingPromise;
}

export const SaDelLogo = memo(function SaDelLogo({
  className = '',
  style,
  onError,
}: {
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
}) {
  const [srcs, setSrcs] = useState<{ light: string; dark: string }>({
    light: cachedLightSrc || '/SaDeL.png',
    dark: cachedDarkSrc || '/SaDeL.png',
  });

  useEffect(() => {
    if (cachedLightSrc && cachedDarkSrc) {
      setSrcs({ light: cachedLightSrc, dark: cachedDarkSrc });
      return;
    }
    void processLogo().then(setSrcs);
  }, []);

  return (
    <>
      <img src={srcs.light} alt="SaDeL Logo" className={`sadel-logo-light ${className}`} style={style} onError={onError} />
      <img src={srcs.dark} alt="SaDeL Logo" className={`sadel-logo-dark ${className}`} style={style} onError={onError} />
    </>
  );
});
