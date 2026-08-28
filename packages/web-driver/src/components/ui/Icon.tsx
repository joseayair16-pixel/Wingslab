'use client';
import { type LucideIcon, type LucideProps } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  className?: string;
  strokeWidth?: number;
} & Omit<LucideProps, 'ref'>;

export function Icon({ icon: IconComponent, className = 'h-5 w-5', strokeWidth = 2, ...rest }: Props) {
  return <IconComponent className={className} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}
