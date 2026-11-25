'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readStoredSession, WINGSLAB_BUSINESS } from '@sadel/shared';
import CheckoutCardForm from '../../../components/CheckoutCardForm';
import { PageHeader } from '../../../components/PageHeader';
import { getCardCheckoutDraft, setCardCheckoutDraft } from '../../../lib/card-checkout-draft';
import { useCartStore } from '../../../store/cartStore';
import type { SavedCard } from '../../../lib/savedCards';

export default function CardPaymentPage() {
  const [checkout, setCheckout] = useState<{
    body: Record<string, unknown>; token: string; apiBase: string; savedCard: SavedCard | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [verified, setVerified] = useState(false);
  const back = `/restaurantes/${encodeURIComponent(WINGSLAB_BUSINESS.restaurantId)}?checkout=true`;
  const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || '';

  useEffect(() => {
    const draft = getCardCheckoutDraft();
    const session = readStoredSession('sadel.customer');
    if (process.env.NEXT_PUBLIC_WINGSLAB_MP_SANDBOX === 'true' && publicKey && draft &&
        draft.restaurantId === WINGSLAB_BUSINESS.restaurantId && session.token &&
        session.user?.id === draft.userId && session.user.role === 'CUSTOMER') {
      setCheckout({ body: draft.body, token: session.token, apiBase: session.apiBase || '/api', savedCard: draft.savedCard ?? null });
    }
    setLoaded(true);
  }, [publicKey]);

  return (
    <main className="wl-page-shell min-h-[100dvh]">
      <PageHeader
        backHref={back}
        backLabel="Volver"
        backReplace
        showBack={!verified}
        onBack={() => {
          setCardCheckoutDraft(null);
          window.dispatchEvent(new Event('wl:refresh-saved-cards'));
        }}
      />
      <div className="mx-auto w-full max-w-lg px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-6">
        {!verified && <h1 className="mb-5 text-center text-lg font-bold tracking-tight sm:text-xl">Pago con tarjeta</h1>}
        {verified ? (
          <div role="status"><p>Pago confirmado.</p><Link href="/cuenta#pedidos" className="underline">Ver mis pedidos</Link></div>
        ) : checkout ? (
          <CheckoutCardForm {...checkout} publicKey={publicKey} onError={() => {}} onVerified={() => {
            useCartStore.getState().clearCart();
            setCardCheckoutDraft(null);
            setCheckout(null);
            setVerified(true);
          }} />
        ) : (
          <p role="status">{loaded ? 'No hay un pago abierto. Vuelve al checkout y selecciona Tarjeta de nuevo.' : 'Cargando el pago…'}</p>
        )}
      </div>
    </main>
  );
}
