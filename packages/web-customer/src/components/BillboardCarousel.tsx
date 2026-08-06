import Image from 'next/image';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

export interface Billboard {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  regions: string[];
  sortIndex: number;
}

interface BillboardCarouselProps {
  billboards: Billboard[];
  onNavigate?: (url: string) => void;
}

// Uber Eats Homepage Billboard full-width: 960x408 (ratio ~2.35:1).
const BILLBOARD_RATIO = 960 / 408;
const AUTOPLAY_INTERVAL_MS = 5000;
const SWIPE_THRESHOLD_PX = 60;
const SWIPE_THRESHOLD_RATIO = 0.2;
const TRANSITION_MS = 600;

// Map a track position back to the real slide index it represents.
const realIndexOf = (p: number, n: number) => (p === 0 ? n - 1 : p === n + 1 ? 0 : p - 1);

export const BillboardCarousel = memo(function BillboardCarousel({
  billboards,
  onNavigate,
}: BillboardCarouselProps) {
  const count = billboards.length;
  const n = count;

  // `pos` is the index inside the rendered track, which is:
  //   [cloneLast, real0..realN-1, cloneFirst]
  // so settled positions live in [1, n]; 0 is the "last" clone and n+1 the
  // "first" clone, used only to make the loop seamless.
  const [pos, setPos] = useState(1);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [suppressTransition, setSuppressTransition] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragRef = useRef({ startX: 0, moved: false, pointerId: -1 });
  const suppressClickRef = useRef(false);
  const firstIdRef = useRef<string | null>(null);
  const posRef = useRef(1);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const stopAutoplay = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startAutoplay = useCallback(() => {
    stopAutoplay();
    if (n <= 1) return;
    timerRef.current = setInterval(() => {
      const p = posRef.current;
      // If a transitionend was missed (e.g. throttled background tab) and we
      // are still on a clone, snap back to the real slide before advancing.
      if (p === 0 || p === n + 1) {
        setSuppressTransition(true);
        setPos(p === 0 ? n : 1);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setSuppressTransition(false);
            setPos((rp) => {
              const real = rp === 0 ? n : rp === n + 1 ? 1 : rp;
              return real === n ? n + 1 : real + 1;
            });
          })
        );
        return;
      }
      setPos(p === n ? n + 1 : p + 1);
    }, AUTOPLAY_INTERVAL_MS);
  }, [n, stopAutoplay]);

  // Reset to the first slide when the source list changes.
  useEffect(() => {
    const first = billboards[0]?.id ?? null;
    if (first !== firstIdRef.current) {
      firstIdRef.current = first;
      setPos(1);
      setDragX(0);
    }
  }, [billboards]);

  useEffect(() => {
    startAutoplay();
    return stopAutoplay;
  }, [startAutoplay, stopAutoplay]);

  // Instantly normalize after landing on a clone so the loop is seamless.
  const snapTo = useCallback((p: number) => {
    setSuppressTransition(true);
    setPos(p);
    requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
  }, []);

  const normalize = useCallback(() => {
    const p = posRef.current;
    if (p === n + 1) snapTo(1);
    else if (p === 0) snapTo(n);
  }, [n, snapTo]);

  // Safety: keep `pos` in bounds if the list shrinks.
  useEffect(() => {
    setPos((p) => {
      if (p > n + 1) return n + 1;
      if (p < 0) return 0;
      return p;
    });
  }, [n]);

  const goToReal = useCallback(
    (t: number) => {
      setPos((p) => {
        const currentReal = realIndexOf(p, n);
        if (currentReal === t) return p;
        const fwd = (t - currentReal + n) % n;
        const bwd = (currentReal - t + n) % n;
        if (fwd <= bwd) {
          return currentReal + fwd === n ? n + 1 : t + 1;
        }
        return t === n - 1 && bwd > 0 ? 0 : t + 1;
      });
    },
    [n]
  );

  const advance = useCallback(() => {
    setPos((p) => {
      const real = p === 0 ? n : p === n + 1 ? 1 : p;
      return real === n ? n + 1 : real + 1;
    });
  }, [n]);

  const goBack = useCallback(() => {
    setPos((p) => {
      const real = p === 0 ? n : p === n + 1 ? 1 : p;
      return real === 1 ? 0 : real - 1;
    });
  }, [n]);

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'transform') return;
    normalize();
  };

  // ── Drag / swipe (pointer events work for mouse + touch) ──────────────────
  const finishDrag = useCallback(
    (clientX: number) => {
      if (dragRef.current.pointerId === -1) return;
      const width = viewportRef.current?.clientWidth || 1;
      const dx = clientX - dragRef.current.startX;
      const threshold = Math.max(SWIPE_THRESHOLD_PX, width * SWIPE_THRESHOLD_RATIO);
      const moved = dragRef.current.moved;

      dragRef.current.pointerId = -1;
      suppressClickRef.current = moved;

      setDragX(0);
      setIsDragging(false);
      setSuppressTransition(false);

      if (moved) {
        if (dx < -threshold) advance();
        else if (dx > threshold) goBack();
      }
      startAutoplay();
    },
    [advance, goBack, startAutoplay]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (n <= 1) return;
    dragRef.current = { startX: event.clientX, moved: false, pointerId: event.pointerId };
    suppressClickRef.current = false;
    setIsDragging(true);
    setSuppressTransition(true);
    stopAutoplay();
  };

  // Track the gesture with window listeners so releasing the pointer outside
  // the carousel still completes the swipe. No pointer capture is used so
  // clicks on dots and slide links keep working normally.
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current.pointerId) return;
      const dx = event.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 10) dragRef.current.moved = true;
      setDragX(dx);
    };
    const onUp = (event: PointerEvent) => finishDrag(event.clientX);
    const onCancel = () => {
      dragRef.current.pointerId = -1;
      setDragX(0);
      setIsDragging(false);
      setSuppressTransition(false);
      startAutoplay();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [isDragging, finishDrag, startAutoplay]);

  const handleNavClick = (url: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onNavigate?.(url);
  };

  if (n === 0) return null;

  const track =
    n > 1 ? [billboards[n - 1], ...billboards, billboards[0]] : billboards;

  const transform = `translate3d(calc(${-pos * 100}% + ${dragX}px), 0, 0)`;
  const transition = isDragging || suppressTransition ? 'none' : `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  const activeReal = realIndexOf(pos, n);

  const slide = (billboard: Billboard, key: string, isClone?: boolean) => {
    const inner = (
      <div className="relative h-full w-full overflow-hidden rounded-2xl">
        <Image
          src={billboard.imageUrl}
          alt="Banner publicitario"
          fill
          sizes="(max-width: 768px) 100vw, 75vw"
          priority={key === `${billboard.id}-real-0`}
          draggable={false}
          className="object-cover"
        />
      </div>
    );
    return (
      <div key={key} className="relative h-full w-full shrink-0" style={{ aspectRatio: `${BILLBOARD_RATIO}` }}>
        {billboard.linkUrl ? (
          <button
            type="button"
            onClick={() => handleNavClick(billboard.linkUrl!)}
            className="block h-full w-full cursor-pointer touch-pan-y select-none text-left"
            aria-label={isClone ? undefined : 'Abrir banner'}
            tabIndex={isClone ? -1 : 0}
          >
            {inner}
          </button>
        ) : (
          <div className="block h-full w-full touch-pan-y select-none">{inner}</div>
        )}
      </div>
    );
  };

  return (
    <div
      className="w-full select-none"
      onMouseEnter={stopAutoplay}
      onMouseLeave={() => {
        if (!isDragging) startAutoplay();
      }}
    >
      <div
        ref={viewportRef}
        className="relative w-full overflow-hidden"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
      >
        <div
          className="flex h-full"
          style={{ transform, transition, willChange: 'transform' }}
          onTransitionEnd={handleTransitionEnd}
        >
          {n > 1
            ? [
                slide(track[0], `${track[0].id}-clone-prev`, true),
                ...billboards.map((b, i) => slide(b, `${b.id}-real-${i}`)),
                slide(track[track.length - 1], `${track[track.length - 1].id}-clone-next`, true),
              ]
            : billboards.map((b, i) => slide(b, `${b.id}-real-${i}`))}
        </div>
      </div>

      {n > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {billboards.map((billboard, i) => (
            <button
              key={billboard.id}
              type="button"
              onClick={() => goToReal(i)}
              aria-label={`Ir al banner ${i + 1}`}
              aria-current={i === activeReal}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === activeReal ? 'w-6 bg-neutral-900' : 'w-1.5 bg-neutral-300 hover:bg-neutral-400'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});
