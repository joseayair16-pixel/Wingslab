'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { takeCardPaymentResult, type ConfirmedCardPayment } from '../lib/card-payment-result';

export default function CardPaymentResultModal() {
  const [result, setResult] = useState<ConfirmedCardPayment | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const next = takeCardPaymentResult();
    if (next) setResult(next);
  }, []);

  useEffect(() => {
    if (result && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [result]);

  if (!result) return null;
  return (
    <dialog ref={dialogRef} onClose={() => setResult(null)} aria-labelledby="card-result-title"
      aria-describedby="card-result-description"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-[28px] border border-neutral-100 bg-white p-6 text-center text-neutral-900 shadow-2xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white sm:p-8">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-950/40">
        <Check className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h2 id="card-result-title" className="mt-7 text-xl font-bold tracking-tight">Pago confirmado</h2>
      <p id="card-result-description" className="mt-2 text-sm leading-6 text-neutral-600 dark:text-zinc-300">
        {result === 'ORDER_CREATED'
          ? 'Tu pago fue aprobado y tu pedido está disponible en Mis pedidos.'
          : 'Tu pago fue aprobado. Estamos terminando de registrar tu pedido; consulta Mis pedidos en unos momentos.'}
      </p>
      <Link href="/cuenta#pedidos" className="mt-6 flex min-h-12 w-full items-center justify-center rounded-2xl bg-neutral-900 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-300 dark:bg-white dark:text-neutral-900">
        Ver mis pedidos
      </Link>
      <button type="button" autoFocus onClick={() => dialogRef.current?.close()}
        className="mt-2 min-h-11 w-full rounded-2xl text-sm font-semibold text-neutral-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-300 dark:text-zinc-300">
        Seguir en el inicio
      </button>
    </dialog>
  );
}
