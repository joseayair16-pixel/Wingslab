import Image from 'next/image';
import React, { memo, useEffect, useRef, useState } from 'react';

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
const AUTOPLAY_INTERVAL_MS = 7000;

export const BillboardCarousel = memo(function BillboardCarousel({
  billboards,
  onNavigate,
}: BillboardCarouselProps) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const count = billboards.length;

  // Keep the active index in bounds if the list shrinks (e.g. zone change).
  useEffect(() => {
    if (count > 0 && index >= count) {
      setIndex(count - 1);
    }
  }, [count, index]);

  useEffect(() => {
    if (count <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  }, [index]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    if (next !== index) setIndex(next);
  };

  if (count === 0) return null;

  return (
    <div className="w-full select-none">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {billboards.map((billboard) => {
          const inner = (
            <div className="relative h-full w-full overflow-hidden rounded-2xl">
              <Image
                src={billboard.imageUrl}
                alt="Banner publicitario"
                fill
                sizes="(max-width: 768px) 100vw, 75vw"
                priority={billboard.id === billboards[0]?.id}
                className="object-cover"
              />
            </div>
          );

          return (
            <div
              key={billboard.id}
              className="relative w-full shrink-0 snap-center"
              style={{ aspectRatio: `${BILLBOARD_RATIO}` }}
            >
              {billboard.linkUrl ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(billboard.linkUrl!)}
                  className="block h-full w-full cursor-pointer text-left"
                  aria-label="Abrir banner"
                >
                  {inner}
                </button>
              ) : (
                <div className="block h-full w-full">{inner}</div>
              )}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {billboards.map((billboard, i) => (
            <button
              key={billboard.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Ir al banner ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-neutral-900' : 'w-1.5 bg-neutral-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});
