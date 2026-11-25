import type { ReactNode } from 'react';

export function SectionHeader({ title, titleId, description, action }: { title: string; titleId?: string; icon: ReactNode; description?: string; action?: ReactNode; className?: string }) {
  return <>
    <h1 id={titleId} className="sr-only">{title}</h1>
    {description && <p className="sr-only">{description}</p>}
    {action && <div className="wl-module-actions">{action}</div>}
  </>;
}
