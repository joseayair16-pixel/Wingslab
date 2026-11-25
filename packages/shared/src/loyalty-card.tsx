'use client';

import { useState } from 'react';

type Props = { logoUrl: string; fallbackLogoUrl: string; name?: string; goal: number; stamps: number; reward: string; preview?: boolean; terms?: string; logoOnDark?: boolean; onStampClick?: (index: number) => void; animateStamp?: number };

/** The same presentational card is used by the restaurant and customer apps.
 * It never computes eligibility or promises a checkout discount. */
export function LoyaltyCard({ logoUrl, fallbackLogoUrl, name = 'WingsLab', goal, stamps, reward, preview = false, terms, logoOnDark = false, onStampClick, animateStamp }: Props) {
  const [failedUrl, setFailedUrl] = useState('');
  const safeGoal = Number.isFinite(goal) ? Math.min(30, Math.max(2, Math.floor(goal))) : 8;
  const totalStamps = Number.isFinite(stamps) ? Math.max(0, Math.floor(stamps)) : 0;
  const filled = Math.min(safeGoal, totalStamps);
  const image = logoUrl && failedUrl !== logoUrl ? logoUrl : fallbackLogoUrl;
  const redLogoFilter = 'brightness(0) saturate(100%) invert(13%) sepia(96%) saturate(6000%) hue-rotate(355deg) brightness(92%) contrast(95%)';
  // Hasta 5 sellos -> una fila. Más de 5 -> dos filas equilibradas, siempre completas.
  const columns = safeGoal <= 5 ? safeGoal : Math.ceil(safeGoal / 2);
  return <section className="wl-loyalty-card-v2" aria-label={preview ? 'Vista previa de la tarjeta de fidelidad' : 'Tu tarjeta de fidelidad'}>
    <style>{`
      .wl-loyalty-card-v2 { position:relative; isolation:isolate; box-sizing:border-box; width:100%; max-width:560px; overflow:hidden; padding:clamp(16px,5vw,34px); border-radius:clamp(18px,4vw,28px); background:radial-gradient(ellipse at 100% 0,rgba(187,10,14,.22),transparent 55%),linear-gradient(140deg,#141012,#080808); color:#fff; box-shadow:0 22px 55px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.08); font-family:Arial,Helvetica,sans-serif; }
      .wl-loyalty-card-v2 * { box-sizing:border-box; }
      .wl-loyalty-card-v2 header { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .wl-loyalty-card-v2 header img { display:block; width:clamp(104px,28vw,180px); height:auto; object-fit:contain; object-position:left center; filter:${redLogoFilter}; }
      .wl-loyalty-card-v2 .wl-loyalty-badge { padding:6px 10px; border:1px solid rgba(255,255,255,.32); border-radius:999px; color:#d8d8d8; font-size:9px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; white-space:nowrap; }
      .wl-loyalty-card-v2 .wl-loyalty-line { width:clamp(38px,9vw,78px); height:4px; margin:clamp(12px,3vw,22px) 0 0; border-radius:4px; background:#e10b11; }
      .wl-loyalty-card-v2 ol { display:grid; gap:clamp(8px,2vw,16px); list-style:none; padding:0; margin:clamp(16px,3.4vw,26px) 0 0; }
      .wl-loyalty-card-v2 li { display:grid; justify-items:center; min-width:0; }
      .wl-loyalty-card-v2 .wl-loyalty-seal { position:relative; display:flex; align-items:center; justify-content:center; width:100%; max-width:var(--wl-seal-max,68px); aspect-ratio:1; border-radius:50%; }
      .wl-loyalty-card-v2 .wl-loyalty-seal.is-empty { border:2px dashed #5d5d5d; color:#8d8d8d; font-size:clamp(16px,4vw,30px); font-weight:800; }
      .wl-loyalty-card-v2 .wl-loyalty-seal.is-reward { border-color:#c81016; color:#ef3b40; background:rgba(200,16,22,.1); }
      .wl-loyalty-card-v2 .wl-loyalty-seal.is-reward svg { width:50%; height:50%; }
      .wl-loyalty-card-v2 .wl-loyalty-seal.is-filled { border:2px solid rgba(239,55,60,.85); background:transparent; box-shadow:none; transform:rotate(-12deg); }
      .wl-loyalty-card-v2 .wl-loyalty-seal.is-filled::after { content:''; position:absolute; inset:4px; border:1px solid rgba(239,55,60,.62); border-radius:50%; pointer-events:none; }
      @keyframes wl-loyalty-press {
        0% { transform:scale(1.62) rotate(-24deg); opacity:0; }
        60% { transform:scale(.94) rotate(-12deg); opacity:1; box-shadow:0 0 14px #ef373c80; }
        100% { transform:scale(1) rotate(-12deg); opacity:1; }
      }
      @media(prefers-reduced-motion:no-preference) { .wl-loyalty-card-v2 .wl-loyalty-seal.is-fresh { animation:wl-loyalty-press .58s cubic-bezier(.22,.8,.3,1) both; } }
      .wl-loyalty-card-v2 button.wl-loyalty-seal { cursor:pointer; min-width:44px; min-height:44px; padding:0; }
      .wl-loyalty-card-v2 button.wl-loyalty-seal:focus-visible { outline:3px solid white; outline-offset:3px; }
      .wl-loyalty-card-v2 .wl-loyalty-seal img { position:relative; z-index:1; display:block; width:135%; max-width:none; flex:none; height:auto; object-fit:contain; filter:${redLogoFilter}; opacity:.9; }
    `}</style>
    <header>
      <img src={image} alt={name} onError={() => setFailedUrl(logoUrl)} style={{ background: 'transparent' }} />
      <span className="wl-loyalty-badge">{preview ? 'Vista previa' : 'Tarjeta de lealtad'}</span>
    </header>
    <div className="wl-loyalty-line" aria-hidden="true" />
    <ol aria-label={`${filled} de ${safeGoal} sellos mostrados`} style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, '--wl-seal-max': safeGoal <= 5 ? '88px' : '68px' } as React.CSSProperties}>
      {Array.from({ length: safeGoal }, (_, index) => {
        const isReward = index === safeGoal - 1;
        const isFilled = index < filled;
        const sealClass = `wl-loyalty-seal ${isFilled ? 'is-filled' : 'is-empty'}${isReward ? ' is-reward' : ''}${isFilled && index + 1 === animateStamp ? ' is-fresh' : ''}`;
        return (
          <li key={index}>
            {isFilled && onStampClick && !preview ? <button type="button" className={sealClass} aria-label={`Ver información del sello ${index + 1}`} onClick={() => onStampClick(index)}><img src={image} alt="" onError={() => setFailedUrl(logoUrl)} /></button> : <span className={sealClass}>
              {isFilled ? (
                <img src={image} alt="" onError={() => setFailedUrl(logoUrl)} />
              ) : isReward ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/><path d="M12 8C9 8 7 7 7 5.5A2.5 2.5 0 0 1 9.5 3C11 3 12 5 12 8zM12 8c3 0 5-1 5-2.5A2.5 2.5 0 0 0 14.5 3C13 3 12 5 12 8z"/></svg>
              ) : (
                <span aria-hidden="true">{index + 1}</span>
              )}
            </span>}
          </li>
        );
      })}
    </ol>
    {terms && <p className="wl-loyalty-terms">{terms}</p>}
  </section>;
}
