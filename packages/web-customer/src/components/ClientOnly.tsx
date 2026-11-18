'use client';

import { useEffect, useState, type ReactNode } from 'react';

/** Renderiza los hijos solo en el navegador, después del primer mount.
 *  Evita cualquier mismatch de hidratación (React #418) cuando el contenido
 *  depende de localStorage, sesión, fecha o APIs del navegador. */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return <>{mounted ? children : fallback}</>;
}
