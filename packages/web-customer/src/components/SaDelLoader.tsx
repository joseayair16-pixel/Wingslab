export function SaDelLoader({
  className = '',
  label,
  size = 'md',
}: {
  className?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-24 w-24' : 'h-16 w-16';

  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <img
        src="/SaDeL.png"
        alt="SaDeL"
        className={`${sizeClass} object-contain animate-sadel-breathe select-none pointer-events-none`}
      />
      {label ? <p className="text-sm font-medium text-neutral-500">{label}</p> : null}
    </div>
  );
}
