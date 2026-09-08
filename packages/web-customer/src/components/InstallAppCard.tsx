'use client';
import { Download, Smartphone, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { fetchPublishedAppVersion, isNativePlatform } from '../lib/native';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Platform = 'ios' | 'android' | 'other';
// Tipo de navegador de escritorio: determina qué herramienta de instalación
// ofrece (Chromium: beforeinstallprompt; Safari: Añadir al Dock; Firefox: ninguna).
type DesktopKind = 'chromium' | 'safari' | 'firefox' | 'unknown';

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/CriOS|OPiOS|FxiOS|EdgiOS/i.test(ua);
}

function detectDesktopKind(): DesktopKind {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Edg|Edge/i.test(ua)) return 'chromium';
  if (/Chrome|Chromium|CriOS/i.test(ua)) return 'chromium';
  if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) return 'safari';
  return 'unknown';
}

// Botón reutilizable con el estilo de las cards del footer (nivel premium).
function InstallCardShell({
  subtitle,
  badge,
  icon,
  disabled,
  disabledLabel,
  onClick,
}: {
  subtitle: string;
  badge?: string;
  icon: ReactNode;
  disabled: boolean;
  disabledLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`group flex w-full items-center gap-3.5 rounded-2xl border border-black/5 bg-white p-3 text-left shadow-sm transition-all duration-300 ${
        disabled
          ? 'cursor-default opacity-70'
          : 'hover:-translate-y-0.5 hover:border-sky-1000/30 hover:shadow-lg hover:shadow-sky-1000/[0.02] active:scale-[0.98]'
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-500 transition-colors group-hover:bg-sky-200">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-extrabold text-neutral-900 transition-colors ${disabled ? '' : 'group-hover:text-sky-500'}`}>
          Instalar la app de SaDeL
        </p>
        <p className="mt-0.5 text-[10px] font-semibold text-neutral-500">
          {disabled ? (disabledLabel ?? 'La app ya está en tu dispositivo') : subtitle}
        </p>
        {badge ? (
          <span className="mt-1 inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">
            {badge}
          </span>
        ) : null}
      </div>
      {!disabled && (
        <div className="pl-1 text-neutral-300 transition-colors group-hover:text-sky-1000">
          <Download className="h-4 w-4" />
        </div>
      )}
    </button>
  );
}

export default function InstallAppCard() {
  const [platform, setPlatform] = useState<Platform>('other');
  const [desktopKind, setDesktopKind] = useState<DesktopKind>('unknown');
  const [isStandalone, setIsStandalone] = useState(false);
  const [isNativeApp, setIsNativeApp] = useState(false);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  deferredPromptRef.current = deferredPrompt;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Detección con User-Agent directo dentro del effect: evitar depender del
    // estado `platform` (aún 'other' en el primer render porque setState es
    // asíncrono) para decidir si descargamos el APK en Android.
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIos = /iPhone|iPad|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    setPlatform(isIos ? 'ios' : isAndroid ? 'android' : 'other');
    setDesktopKind(detectDesktopKind());
    setIsNativeApp(isNativePlatform());

    const mq = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mq.addEventListener?.('change', onChange);

    if (isAndroid && !isNativePlatform()) {
      fetchPublishedAppVersion('/api')
        .then((v) => { if (v?.url) setApkUrl(v.url); })
        .catch(() => { /* sin APK publicado: la card ofrece PWA */ });
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mq.removeEventListener?.('change', onChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alreadyInstalled = isNativeApp || isStandalone;
  if (alreadyInstalled) {
    return (
      <InstallCardShell
        subtitle="Listo, ya puedes pedir sin abrir el navegador"
        badge="Instalada"
        icon={<Smartphone className="h-5 w-5" />}
        disabled
        disabledLabel="App instalada"
        onClick={() => {}}
      />
    );
  }

  const handleClick = () => {
    setOpen(true);
  };

  const handleAndroidAction = async () => {
    if (apkUrl) {
      setInstalling(true);
      window.location.href = apkUrl;
      return;
    }
    if (!deferredPromptRef.current) {
      return;
    }
    try {
      setInstalling(true);
      await deferredPromptRef.current.prompt();
      const { outcome } = await deferredPromptRef.current.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsStandalone(true);
        setOpen(false);
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <InstallCardShell
        subtitle={
          platform === 'ios'
            ? 'Agrega SaDeL a tu pantalla de inicio'
            : platform === 'android'
              ? apkUrl
                ? 'Descarga la app nativa de Android'
                : 'Instala como app y pide sin abrir el navegador'
              : 'Instala SaDeL en tu dispositivo'
        }
        badge={platform === 'android' && apkUrl ? 'APK' : 'PWA'}
        icon={<Download className="h-5 w-5" />}
        disabled={false}
        onClick={handleClick}
      />

      {open && (
        <div className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/45 px-4 pb-8 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-label="Instalar la app de SaDeL">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-bold text-neutral-900">
                {platform === 'ios'
                  ? 'Instalar SaDeL en tu iPhone'
                  : platform === 'android'
                    ? 'Instalar SaDeL en tu Android'
                    : 'Instalar SaDeL como app'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {platform === 'ios' ? (
              <IOSGuide />
            ) : platform === 'android' && apkUrl ? (
              <AndroidApkGuide apkUrl={apkUrl} installing={installing} onDownload={handleAndroidAction} />
            ) : platform === 'android' ? (
              <AndroidPwaGuide installing={installing} promptAvailable={Boolean(deferredPrompt)} onInstall={handleAndroidAction} />
            ) : (
              <DesktopGuide
                desktopKind={desktopKind}
                installing={installing}
                promptAvailable={Boolean(deferredPrompt)}
                onInstall={handleAndroidAction}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function IOSGuide() {
  const inSafari = isIosSafari();
  return (
    <div>
      {!inSafari ? (
        <div className="mb-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
          En iPhone las apps web solo se instalan desde <span className="font-bold">Safari</span>. Abre
          SaDeL en Safari siguiendo estos pasos:
        </div>
      ) : (
        <p className="mb-4 text-sm leading-relaxed text-neutral-600">
          Sigue estos pasos y tendrás SaDeL en tu pantalla de inicio:
        </p>
      )}
      <ol className="space-y-3 text-sm">
        <Step n={1} active={!inSafari}>
          {inSafari ? (
            <>
              Toca el botón <Bold>Compartir</Bold>{' '}
              <InlineIcon>⤴</InlineIcon> (abajo en Safari).
            </>
          ) : (
            <>
              Abre <Bold>Chrome</Bold> u otro navegador, copia la dirección de SaDeL y ábrela en{' '}
              <Bold>Safari</Bold> (elige Safari en el menú «Compartir»).
            </>
          )}
        </Step>
        <Step n={2} active={!inSafari}>
          {inSafari ? (
            <>
              Desplázate y toca <Bold>Añadir a pantalla de inicio</Bold>.
            </>
          ) : (
            <>
              Una vez en Safari, toca <Bold>Compartir</Bold> <InlineIcon>⤴</InlineIcon>.
            </>
          )}
        </Step>
        <Step n={3} active>
          {inSafari ? (
            <>
              Toca <Bold>Añadir</Bold> arriba a la derecha. ¡Listo!
            </>
          ) : (
            <>
              Toca <Bold>Añadir a pantalla de inicio</Bold> y por último <Bold>Añadir</Bold>. ¡Listo!
            </>
          )}
        </Step>
      </ol>
      <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        Nota: desde la pantalla de inicio podrás pedir y recibir notificaciones como una app.
      </div>
    </div>
  );
}

function AndroidApkGuide({ apkUrl, installing, onDownload }: { apkUrl: string; installing: boolean; onDownload: () => void }) {
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        Descarga la app nativa de SaDeL para Android. Es más rápida, usa menos datos y
        notificaciones fiables.
      </p>
      <button
        type="button"
        onClick={onDownload}
        disabled={installing}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-70"
      >
        <Smartphone className="h-4 w-4" />
        {installing ? 'Preparando descarga…' : 'Descargar APK'}
      </button>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-400">
        Puede que Android pida permiso para instalar apps de orígenes desconocidos. Código fuente de la app: {apkUrl}
      </p>
    </div>
  );
}

function AndroidPwaGuide({ installing, promptAvailable, onInstall }: { installing: boolean; promptAvailable: boolean; onInstall: () => void }) {
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        Añade SaDeL como app. No necesitas descargar nada: se instalará al instante
        desde el navegador.
      </p>
      <button
        type="button"
        onClick={onInstall}
        disabled={installing || !promptAvailable}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-70"
      >
        <Download className="h-4 w-4" />
        {installing ? 'Instalando…' : 'Instalar SaDeL'}
      </button>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-400">
        {promptAvailable
          ? 'Si el botón no responde, usa el menú del navegador › «Instalar app».'
          : 'El navegador aún no habilita la instalación. Ábrelo en el menú › «Instalar app» cuando aparezca.'}
      </p>
    </div>
  );
}

function DesktopGuide({ desktopKind, installing, promptAvailable, onInstall }: { desktopKind: DesktopKind; installing: boolean; promptAvailable: boolean; onInstall: () => void }) {
  if (desktopKind === 'safari') {
    return <SafariDesktopGuide />;
  }
  if (desktopKind === 'firefox') {
    return <FirefoxDesktopGuide />;
  }
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        Usa el botón de abajo o el ícono <Bold>Instalar app</Bold> que aparece en la barra de
        direcciones del navegador para instalar SaDeL como una app de escritorio.
      </p>
      <button
        type="button"
        onClick={onInstall}
        disabled={installing || !promptAvailable}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-70"
      >
        <Download className="h-4 w-4" />
        {installing ? 'Instalando…' : 'Instalar SaDeL'}
      </button>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-400">
        {promptAvailable
          ? 'Si el botón no responde, usa el ícono «Instalar» en la barra del navegador.'
          : 'El navegador aún no habilita la instalación automática. Usa el ícono «Instalar» de la barra de direcciones cuando aparezca.'}
      </p>
    </div>
  );
}

function SafariDesktopGuide() {
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        Safari para escritorio instala las apps web desde el menú <Bold>Archivo</Bold>.
      </p>
      <ol className="space-y-3 text-sm">
        <Step n={1}>
          Abre SaDeL en <Bold>Safari</Bold> (esta página ya lo está).
        </Step>
        <Step n={2}>
          En la barra superior, abre el menú <Bold>Archivo</Bold> y toca{' '}
          <Bold>Añadir al Dock</Bold>.
        </Step>
        <Step n={3}>
          Toca <Bold>Añadir</Bold>. SaDeL quedará en tu Dock y se abrirá como app.
        </Step>
      </ol>
      <div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
        ¿No aparece la opción? Abre SaDeL en <Bold>Google Chrome</Bold> o{' '}
        <Bold>Microsoft Edge</Bold> y usa el ícono <Bold>Instalar</Bold>{' '}
        de la barra de direcciones.
      </div>
    </div>
  );
}

function FirefoxDesktopGuide() {
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        <Bold>Firefox</Bold> para escritorio no instala apps web. Para tener SaDeL
        como app de escritorio:
      </p>
      <ol className="space-y-3 text-sm">
        <Step n={1}>
          Abre SaDeL en <Bold>Google Chrome</Bold> o <Bold>Microsoft Edge</Bold>.
        </Step>
        <Step n={2}>
          Toca el ícono <Bold>Instalar</Bold>{' '}
          <InlineIcon>⤴</InlineIcon> que aparece en la barra de direcciones.
        </Step>
        <Step n={3}>
          Confirma la instalación. SaDeL se abrirá como app de escritorio.
        </Step>
      </ol>
      <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        Recomendamos Chrome o Edge para la mejor experiencia con notificaciones.
      </div>
    </div>
  );
}

function Step({ n, children, active = true }: { n: number; children: ReactNode; active?: boolean }) {  return (
    <li className={`flex items-start gap-3 ${active ? '' : 'opacity-50'}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
        {n}
      </span>
      <span className="leading-relaxed text-neutral-700">{children}</span>
    </li>
  );
}

function Bold({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-neutral-900">{children}</span>;
}

function InlineIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-bold text-neutral-700">
      {children}
    </span>
  );
}
