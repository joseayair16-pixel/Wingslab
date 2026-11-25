'use client';

import { useState } from 'react';

type Props = {
  activate: () => Promise<void>;
  onActivated?: () => void;
  className: string;
};

export function PushActivationButton({ activate, onActivated, className }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setPending(true);
    setError('');
    try {
      await activate();
      onActivated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron activar los avisos.');
    } finally {
      setPending(false);
    }
  }

  return <>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="button" className={className} onClick={handleClick} disabled={pending}>
      {pending ? 'Activando…' : 'Activar notificaciones'}
    </button>
  </>;
}
