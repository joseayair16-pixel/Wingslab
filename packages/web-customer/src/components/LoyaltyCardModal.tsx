'use client';

import { useEffect, useRef, useState } from 'react';
import { getWingslabApiUrl, readStoredSession, requestJson } from '@sadel/shared';
import { Award, Gift, QrCode, X } from 'lucide-react';
import logo from '../assets/wingslab-wordmark.png';
import { LoyaltyCard } from '../../../shared/src/loyalty-card';
import { LoyaltyQrPanel } from './LoyaltyQrPanel';

type Card = { enabled: boolean; stamps: number; stampGoal: number; rewardDescription: string; stampTerms: string; redemptionEnabled: boolean; availableRewards?: number; eligibleForNextOrder?: boolean; reserved?: boolean; brand?: { name: string; logo: string | null } };
export function LoyaltyCardModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [guest, setGuest] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const session = readStoredSession('sadel.customer');
    if (!session?.token) { setGuest(true); return; }
    let alive = true;
    void requestJson<{ data: Card }>({ apiBase: getWingslabApiUrl(), path: '/customer/lealtad', token: session.token }).then(result => {
      if (alive) { setCard(result.data); setError(''); }
    }).catch(() => { if (alive) setError('No pudimos actualizar tu tarjeta. Cierra y vuelve a intentarlo.'); });
    return () => { alive = false; };
  }, [revision]);
  const goal = card ? Math.min(30, Math.max(2, card.stampGoal)) : 0;
  return <dialog ref={dialog} className="wl-loyalty-dialog wl-premium-dialog" aria-labelledby="loyalty-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className="wl-dialog-top"><div><span className="wl-kicker">Siempre es un gusto verte</span><h2 id="loyalty-title">Tu tarjeta WingsLab</h2></div><button type="button" aria-label="Cerrar tarjeta" onClick={() => dialog.current?.close()}><X /></button></div>
    {guest ? <div className="wl-premium-empty"><Award /><h3>Tu próxima visita cuenta</h3><p>Inicia sesión para consultar tu tarjeta y el estado del programa.</p><a href="/cuenta#perfil" className="wl-primary-action">Ir a mi perfil</a></div> : !card ? <p role={error ? 'alert' : 'status'}>{error || 'Consultando tu tarjeta…'}</p> : showQr ? (
      <LoyaltyQrPanel onClose={() => setShowQr(false)} onRefresh={() => setRevision(value => value + 1)} brand={card.brand} fallbackLogoUrl={logo.src} />
    ) : !card.enabled && !card.redemptionEnabled ? <div className="wl-premium-empty"><Award /><h3>Programa no disponible</h3><p>El restaurante aún no ha activado su tarjeta de fidelidad.</p></div> : <>
      {error && <p role="status">{error}</p>}
      {!card.enabled && <p role="status">Programa en pausa. Tus sellos y premios se conservan.</p>}
      {card.enabled && <button type="button" className="wl-loyalty-qr-trigger" onClick={() => setShowQr(true)}><QrCode aria-hidden="true"/><span><strong>Mostrar QR en caja</strong><small>Recibe un sello por tu compra en el local</small></span></button>}
      <LoyaltyCard logoUrl={card.brand?.logo || logo.src} fallbackLogoUrl={logo.src} name={card.brand?.name} logoOnDark={!card.brand?.logo} goal={goal} stamps={card.stamps} reward={card.rewardDescription} terms={card.stampTerms} />
      <div className="wl-reward-summary"><Gift aria-hidden="true" /><div><span className="wl-kicker">Tu recompensa</span><h3>{card.rewardDescription || 'Consulta la recompensa con el restaurante'}</h3><p>Completa {goal} compras para alcanzar la meta.</p></div></div>
      <div className="wl-card-explanation"><h3>¿Cómo funciona?</h3><p>Un pedido completado equivale a un sello. No cuentan cancelaciones ni pedidos en reparto. El premio se aplica en la compra que completa la tarjeta.</p>{!!card.availableRewards && <p><strong>{card.availableRewards} recompensa(s) ganada(s) disponible(s).</strong> Se conservan junto al progreso de tu siguiente tarjeta.</p>}{card.reserved && <p>Tu premio está reservado en un pedido en curso. Si se cancela o rechaza, vuelve a estar disponible.</p>}{card.eligibleForNextOrder && <p><strong>Tu próxima compra puede llevar premio.</strong> Revisa el beneficio antes de confirmar el pedido; no se combina con promociones.</p>}<p>{card.redemptionEnabled ? 'El carrito valida disponibilidad, muestra el descuento o agrega el producto de regalo automáticamente. Solo se usa una recompensa por pedido.' : 'El restaurante debe terminar de configurar el beneficio para habilitar el canje. Tus compras registradas se conservan.'}</p></div>
    </>}
  </dialog>;
}
