'use client';

import { useEffect, useState } from 'react';

type Preference = 'light' | 'dark' | 'system';
const key = 'wingslab.theme';

export function ThemePreference() {
  const [preference, setPreference] = useState<Preference>('system');
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === 'light' || stored === 'dark' || stored === 'system') setPreference(stored);
    } catch { /* System preference remains available in private browsing. */ }
    const sync = (event: Event) => { const value = (event as CustomEvent<Preference>).detail; if (value === 'light' || value === 'dark' || value === 'system') setPreference(value); };
    const storage = (event: StorageEvent) => { if (event.key === key) setPreference(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system'); };
    window.addEventListener('wingslab:theme', sync); window.addEventListener('storage', storage);
    return () => { window.removeEventListener('wingslab:theme', sync); window.removeEventListener('storage', storage); };
  }, []);
  function change(value: Preference) {
    setPreference(value);
    try { localStorage.setItem(key, value); } catch { /* Keep the in-memory selection. */ }
    window.dispatchEvent(new CustomEvent('wingslab:theme', { detail: value }));
  }
  return <section className="wl-theme-settings" aria-labelledby="appearance-title">
    <div><h2 id="appearance-title">Apariencia</h2><p>Elige cómo se ve WingsLab en este dispositivo.</p></div>
    <div role="group" aria-label="Tema de la aplicación" className="wl-theme-options">
      {([['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={preference === value} onClick={() => change(value)}>{label}</button>)}
    </div>
  </section>;
}
