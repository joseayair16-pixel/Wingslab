'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CreditCard, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { SavedCard } from '../lib/savedCards';

type Props = {
  apiBase: string;
  token: string;
  selectedId: string | null;
  onSelect: (card: SavedCard | null) => void;
  onLoadingChange: (loading: boolean) => void;
};

export default function SavedCardSelector({ apiBase, token, selectedId, onSelect, onLoadingChange }: Props) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onLoadingChangeRef = useRef(onLoadingChange);
  selectedIdRef.current = selectedId;
  onSelectRef.current = onSelect;
  onLoadingChangeRef.current = onLoadingChange;

  async function removeCard(card: SavedCard) {
    setRemoving(true);
    setRemoveError('');
    try {
      const response = await fetch(`${apiBase}/me/payment-methods/cards/${encodeURIComponent(card.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error('remove_failed');
      setCards(current => current.filter(item => item.id !== card.id));
      if (selectedIdRef.current === card.id) onSelectRef.current(null);
      setPendingRemoval(null);
    } catch {
      setRemoveError('No pudimos quitar la tarjeta. Inténtalo de nuevo.');
    } finally {
      setRemoving(false);
    }
  }

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    onLoadingChangeRef.current(true);
    setError(false);
    try {
      const response = await fetch(`${apiBase}/me/payment-methods/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
      });
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.data)) throw new Error('unavailable');
      const safeCards = result.data as SavedCard[];
      setCards(safeCards);
      if (selectedIdRef.current && !safeCards.some(card => card.id === selectedIdRef.current)) onSelectRef.current(null);
    } catch {
      if (!signal.aborted) setError(true);
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        onLoadingChangeRef.current(false);
      }
    }
  }, [apiBase, token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('wl:refresh-saved-cards', refresh);
    return () => window.removeEventListener('wl:refresh-saved-cards', refresh);
  }, []);

  if (loading) {
    return <div role="status" className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-neutral-50 px-3.5 py-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-400">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando tus tarjetas…
    </div>;
  }

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/20 dark:bg-amber-500/10">
      <p role="alert" className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">No pudimos cargar tus tarjetas guardadas.</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={() => setRevision(value => value + 1)} className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-amber-900 underline decoration-amber-400 underline-offset-2 dark:text-amber-100">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reintentar
        </button>
        <button type="button" onClick={() => onSelect(null)} className="min-h-10 text-xs font-semibold text-amber-900 underline underline-offset-2 dark:text-amber-100">
          Usar una tarjeta nueva
        </button>
      </div>
    </div>;
  }

  if (!cards.length) return null;

  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2 text-xs font-semibold text-neutral-700 dark:text-zinc-300">Elige una tarjeta</legend>
      {cards.map(card => {
        const selected = selectedId === card.id;
        return (
          <div key={card.id}>
          <label className={`relative flex min-h-[68px] cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)]/40 ${
            selected
              ? 'border-[var(--accent)] bg-[var(--accent)]/[0.06] ring-1 ring-[var(--accent)]/20'
              : 'border-neutral-200/80 bg-white hover:border-neutral-300 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20'
          }`}>
            <input type="radio" name="saved-payment-card" value={card.id} checked={selected}
              onChange={() => onSelect(card)} className="sr-only left-0 top-0" aria-label={`${card.paymentMethod.name}, termina en ${card.lastFourDigits}`} />
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-[var(--accent)] text-white' : 'bg-neutral-100 text-neutral-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
              <CreditCard className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-neutral-900 dark:text-white">{card.paymentMethod.name} <span className="font-medium text-neutral-500 dark:text-zinc-400">•••• {card.lastFourDigits}</span></span>
              <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-zinc-400">
                {card.expirationMonth && card.expirationYear ? `Vence ${String(card.expirationMonth).padStart(2, '0')}/${String(card.expirationYear).slice(-2)}` : 'Tarjeta guardada en Mercado Pago'}
              </span>
            </span>
            <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-neutral-300 dark:border-zinc-600'}`}>
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
          </label>
          {pendingRemoval === card.id ? (
            <div className="mt-1 flex items-center justify-end gap-2 px-1">
              <span className="mr-auto text-[11px] text-neutral-500 dark:text-zinc-400">¿Quitar esta tarjeta?</span>
              <button type="button" disabled={removing} onClick={() => setPendingRemoval(null)} className="min-h-9 px-2 text-xs font-semibold text-neutral-600 underline dark:text-zinc-300">Cancelar</button>
              <button type="button" disabled={removing} onClick={() => void removeCard(card)} className="min-h-9 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white disabled:opacity-50">{removing ? 'Quitando…' : 'Sí, quitar'}</button>
            </div>
          ) : (
            <button type="button" onClick={() => { setRemoveError(''); setPendingRemoval(card.id); }}
              aria-label={`Quitar ${card.paymentMethod.name} que termina en ${card.lastFourDigits}`}
              className="ml-1 mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40 dark:focus-visible:ring-offset-zinc-900">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Quitar tarjeta
            </button>
          )}
          </div>
        );
      })}
      {removeError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{removeError}</p>}
      <button type="button" onClick={() => onSelect(null)} aria-pressed={!selectedId}
        className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 ${
          !selectedId ? 'border-[var(--accent)] bg-[var(--accent)]/[0.06] text-neutral-900 dark:text-white' : 'border-neutral-200/80 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-white/5'
        }`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${!selectedId ? 'bg-[var(--accent)] text-white' : 'bg-neutral-100 text-neutral-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
          <Plus className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Pagar con otra tarjeta</span>
        </span>
        <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${!selectedId ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-neutral-300 dark:border-zinc-600'}`}>
          {!selectedId && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      </button>
    </fieldset>
  );
}
