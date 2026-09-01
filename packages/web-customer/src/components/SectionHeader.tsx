import type { CSSProperties, ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  icon?: ReactNode;
  count?: { value: number; label: string };
  countIcon?: ReactNode;
  divider?: boolean;
  className?: string;
  accent?: string;
}

/**
 * Encabezado premium y consistente para secciones y categorías.
 * Combina un ancla visual (chip de icono o rail de acento), eyebrow,
 * título, subtítulo opcional y una píldora de conteo, con divider opcional
 * para marcar con claridad dónde empieza cada sección. El acento respeta el
 * color de marca del restaurante (`--menu-accent`) y cae a sky en home.
 */
export function SectionHeader({
  title,
  eyebrow,
  subtitle,
  icon,
  count,
  countIcon,
  divider = false,
  className = '',
  accent = 'rgb(14 165 233)',
}: SectionHeaderProps) {
  const accentStyles: CSSProperties = {
    '--section-accent': accent,
  } as CSSProperties;

  return (
    <div className={className} style={accentStyles}>
      {divider && (
        <div
          className="mb-5 h-px w-full bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.08]"
          aria-hidden="true"
        />
      )}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 dark:ring-white/10"
              style={{
                color: 'var(--section-accent)',
                background: `linear-gradient(135deg, color-mix(in srgb, var(--section-accent) 16%, white), color-mix(in srgb, var(--section-accent) 6%, white), color-mix(in srgb, var(--section-accent) 22%, white))`,
                boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--section-accent) 18%, transparent)',
              }}
            >
              {icon}
            </div>
          ) : (
            <span
              className="h-9 w-1.5 shrink-0 rounded-full"
              style={{
                background: `linear-gradient(to bottom, color-mix(in srgb, var(--section-accent) 70%, white), var(--section-accent))`,
                boxShadow: `0 2px 10px color-mix(in srgb, var(--section-accent) 35%, transparent)`,
              }}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ color: 'color-mix(in srgb, var(--section-accent) 85%, transparent)' }}
              >
                {eyebrow}
              </p>
            )}
            <h2 className="truncate text-xl font-black tracking-[-0.02em] text-neutral-950 dark:text-white sm:text-2xl sm:tracking-[-0.03em]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs font-medium text-neutral-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {count && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold text-neutral-600 shadow-[0_2px_10px_rgba(15,15,15,0.05)] ring-1 ring-black/[0.06] backdrop-blur dark:bg-zinc-900/80 dark:text-zinc-300 dark:ring-white/10 sm:text-xs">
            <span className="text-sky-500 dark:text-sky-400" style={{ color: 'var(--section-accent)' }} aria-hidden="true">
              {countIcon}
            </span>
            <span className="font-black text-neutral-950 dark:text-white">{count.value}</span>
            {count.label}
          </span>
        )}
      </div>
    </div>
  );
}