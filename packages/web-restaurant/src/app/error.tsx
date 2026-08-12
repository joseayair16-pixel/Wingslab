'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="rounded-full bg-rose-50 p-6">
        <span className="text-4xl">⚠️</span>
      </div>
      <h1 className="text-2xl font-bold text-neutral-900">Algo salió mal</h1>
      <p className="max-w-md text-neutral-500">
        Ocurrió un error inesperado. Por favor intenta de nuevo.
      </p>
      <button
        onClick={reset}
        className="rounded-full bg-sky-600 px-8 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-700"
      >
        Intentar de nuevo
      </button>
    </div>
  );
}
