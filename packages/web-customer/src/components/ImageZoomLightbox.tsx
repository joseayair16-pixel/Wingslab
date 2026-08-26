'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImageZoomLightboxProps {
  open: boolean;
  images: string[];
  index: number;
  onIndexChange: (i: number) => void;
  name: string;
  onClose: () => void;
}

export default function ImageZoomLightbox({
  open,
  images,
  index,
  onIndexChange,
  name,
  onClose,
}: ImageZoomLightboxProps) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Scroll lock + focus management + keyboard handling (Esc + focus trap)
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && overlayRef.current) {
        const focusable = Array.from(
          overlayRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open || images.length === 0) return null;

  const current = images[index];
  const hasMultiple = images.length > 1;

  const go = (dir: number) => {
    if (!hasMultiple) return;
    onIndexChange((index + dir + images.length) % images.length);
  };

  // Close only when the backdrop itself is clicked (never the image/controls),
  // so pinch / double-tap-to-zoom on the photo is never hijacked.
  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/95 backdrop-blur-sm overscroll-contain"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Imagen de ${name}`}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X className="h-5 w-5" strokeWidth={2.5} />
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Imagen anterior"
            className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:left-6"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Imagen siguiente"
            className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:right-6"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </>
      )}

      <TransformWrapper
        key={index}
        initialScale={1}
        minScale={1}
        maxScale={5}
        doubleClick={{ mode: 'toggle', step: 2 }}
        wheel={{ step: 0.2 }}
        pinch={{ step: 5 }}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
          wrapperClass="!flex items-center justify-center"
        >
          {current ? (
            <img
              src={current}
              alt={name}
              draggable={false}
              className="max-h-[88vh] max-w-[92vw] cursor-grab touch-none select-none object-contain active:cursor-grabbing"
            />
          ) : null}
        </TransformComponent>
      </TransformWrapper>

      {hasMultiple && (
        <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir a la imagen ${i + 1}`}
              aria-current={i === index}
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange(i);
              }}
              className={`h-2 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                i === index ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
