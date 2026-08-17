'use client';
import { ChevronLeft } from 'lucide-react';

import Link from 'next/link';
import { SaDelLogo } from '../../components/SaDelLogo';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 font-sans pb-16">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white text-neutral-800 shadow-sm transition hover:bg-neutral-50 active:scale-95 animate-fade-in"
              aria-label="Volver al inicio"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <SaDelLogo className="h-7 w-auto object-contain" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">Legal</span>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
        <div className="rounded-[32px] bg-white border border-black/5 shadow-[0_16px_50px_rgba(0,0,0,0.03)] p-6 md:p-10 text-left space-y-6 animate-scale-up">
          
          <div className="border-b border-black/5 pb-4">
            <h1 className="text-3xl font-extrabold tracking-tight text-neutral-950 md:text-4xl">Aviso de Privacidad Integral</h1>
            <p className="text-xs text-neutral-400 font-semibold mt-2 font-mono">Última actualización: 5 de agosto de 2026</p>
          </div>

          <div className="space-y-6 text-sm text-neutral-600 leading-relaxed font-medium">
            
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">1. Identidad y Domicilio del Responsable</h2>
              <p>
                El tratamiento de sus datos personales es responsabilidad de <strong>SAD SERVICES & DELIVERY LAB, S. DE R.L. DE C.V.</strong> (en lo sucesivo identificado comercialmente como <strong>&quot;SaDeL&quot;</strong>), con domicilio fiscal y para oír y recibir todo tipo de notificaciones el ubicado en la Avenida Francisco I. Madero Oriente, Colonia Centro, Código Postal 58000, Morelia, Michoacán de Ocampo, México.
              </p>
              <p>
                SaDeL cuenta con un departamento especializado en la protección de datos personales que atenderá cualquier duda, aclaración o solicitud relacionada con este documento a través de los canales institucionales de contacto: <a href="mailto:compliance@sadel.com" className="text-sky-500 hover:underline">compliance@sadel.com</a> y <a href="mailto:legal@sadel.com" className="text-sky-500 hover:underline">legal@sadel.com</a>.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">2. Datos Personales Recopilados y Sometidos a Tratamiento</h2>
              <p>
                SaDeL recaba información de manera directa e indirecta a través de su plataforma tecnológica (portal web, portal del comensal, portal de restaurantes y portal de repartidores). Dependiendo de su perfil dentro del ecosistema SaDeL, los datos recopilados son:
              </p>
              
              <div className="space-y-4 pl-4 border-l-2 border-neutral-100 mt-2">
                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">A. Para Usuarios Comensales (Clientes):</h3>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li><strong>Datos de Identificación:</strong> Nombre, apellidos, número telefónico (móvil).</li>
                    <li><strong>Datos de Ubicación y Geolocalización:</strong> Dirección de entrega (calle, número externo/interno, colonia, referencias adicionales) y coordenadas GPS en tiempo real obtenidas mediante su navegador o dispositivo móvil (indispensables para estimar tiempos de entrega y calcular tarifas de envío operativas).</li>
                    <li><strong>Datos Financieros y Patrimoniales:</strong> Capturas de pantalla de comprobantes de transferencias bancarias (en esquemas de pago offline).</li>
                  </ul>
                  <p className="text-xs text-neutral-400 mt-2 font-mono">
                    *Nota: Los datos de tarjetas de débito/crédito son tokenizados y procesados directamente por procesadores de pago certificados internacionalmente bajo la norma PCI-DSS, por lo que SaDeL no almacena sus claves bancarias ni números de tarjeta en sus servidores.
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">B. Para Socios Comerciales (Restaurantes / Establecimientos):</h3>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li><strong>Datos del Responsable:</strong> Nombre del representante legal o propietario, número de WhatsApp, identificación oficial (INE/Pasaporte) y firma autógrafa.</li>
                    <li><strong>Datos del Negocio:</strong> Nombre comercial de la marca, giro del negocio, dirección física de la sucursal, datos fiscales de facturación (RFC, Régimen Fiscal, Código Postal fiscal) y cuenta bancaria de destino para dispersión de fondos.</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">C. Para Repartidores (Socios Repartidores Independientes):</h3>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li><strong>Datos Personales:</strong> Nombre completo, teléfono móvil de contacto.</li>
                    <li><strong>Datos de Tránsito y Operación:</strong> Ubicación GPS en tiempo real (mientras la cuenta permanezca activa e iniciada para rastreo en ruta), características del vehículo de reparto (marca, modelo de la motocicleta, placas de circulación) y zona de cobertura operativa.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">3. Finalidades del Tratamiento de los Datos Personales</h2>
              <p>
                Las finalidades del tratamiento se clasifican en primarias (esenciales para proveer la relación jurídica) y secundarias (accesorias):
              </p>
              
              <div className="space-y-3 mt-2">
                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">Finalidades Primarias (Necesarias):</h3>
                  <ol className="list-decimal list-inside mt-1 space-y-1">
                    <li><strong>Prestación de Servicios:</strong> Procesamiento de órdenes, validación de inventario y preparación de alimentos por parte del restaurante.</li>
                    <li><strong>Logística y Entrega:</strong> Asignación de repartidores cercanos a las rutas mediante algoritmos de geolocalización activa y transmisión de las coordenadas de entrega.</li>
                    <li><strong>Validación Transaccional:</strong> Confirmación y conciliación de pagos electrónicos y offline (conciliación de comprobantes de transferencia bancaria).</li>
                    <li><strong>Seguridad y Prevención de Fraudes:</strong> Emisión de códigos NIP únicos de entrega y validación de entrega de pedidos.</li>
                    <li><strong>Canales de Soporte:</strong> Facilitar el chat integrado y llamadas operativas directas entre el Comensal, el Restaurante y el Repartidor para resolver incidencias de entrega.</li>
                  </ol>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">Finalidades Secundarias (Accesorias y Opcionales):</h3>
                  <ol className="list-decimal list-inside mt-1 space-y-1">
                    <li>Envío de campañas publicitarias, promociones personalizadas y cupones de descuento.</li>
                    <li>Evaluaciones de calidad del servicio mediante encuestas de satisfacción.</li>
                    <li>Estadísticas analíticas de consumo para optimización de catálogo de platillos y mejora de la plataforma.</li>
                  </ol>
                  <p className="text-xs text-neutral-400 mt-2 font-mono">
                    En caso de que no desee que sus datos personales sean tratados para las Finalidades Secundarias, puede manifestar su negativa enviando un correo electrónico a <a href="mailto:compliance@sadel.com" className="text-sky-500 hover:underline">compliance@sadel.com</a>.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">4. Transferencia de Datos Personales</h2>
              <p>
                SaDeL únicamente comparte datos personales bajo estricto apego a las excepciones previstas en el Artículo 37 de la LFPDPPP, limitándose a:
              </p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li><strong>Con el Restaurante Preparador:</strong> Transmisión del nombre de pila del cliente, especificaciones del platillo y número de orden para fines de empaque.</li>
                <li><strong>Con el Socio Repartidor:</strong> Transmisión del nombre de pila del cliente, dirección exacta de entrega, geolocalización de destino y teléfono de contacto temporal para asegurar el arribo y entrega segura del pedido.</li>
                <li><strong>Con Meta Platforms, Inc. (proveedor de la API de WhatsApp Business):</strong> Cuando un usuario solicita un código de verificación (OTP) o cuando un establecimiento activa las notificaciones de pedido por WhatsApp, SaDeL transmite el número telefónico del destinatario y el contenido del mensaje a Meta Platforms, Inc. con la única finalidad de entregar dichos mensajes a través de WhatsApp. Meta actúa como procesador de datos bajo las condiciones de su propia política de privacidad.</li>
              </ul>
              <p className="font-bold text-neutral-900 mt-2">
                No comercializamos, vendemos ni transferimos sus datos personales a agencias de marketing o terceros sin su consentimiento previo.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">5. Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición)</h2>
              <p>
                De conformidad con la legislación aplicable, usted tiene en todo momento el derecho de acceder a sus datos personales, corregirlos si son incorrectos, cancelarlos cuando ya no sean necesarios o bien oponerse al tratamiento de los mismos para fines específicos.
              </p>
              <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider mt-2">Procedimiento de Solicitud de Derechos ARCO:</h3>
              <p>
                Para ejercer cualquiera de los Derechos ARCO, el titular o su representante legal deberá enviar una solicitud formal al correo electrónico <a href="mailto:legal@sadel.com" className="text-sky-500 hover:underline">legal@sadel.com</a> adjuntando los siguientes requisitos:
              </p>
              <ol className="list-decimal list-inside mt-1 space-y-1 pl-2">
                <li>Nombre completo del titular y medio de contacto (teléfono y correo electrónico).</li>
                <li>Documento que acredite su identidad (INE o Pasaporte vigente digitalizados). En caso de representante legal, el poder notarial correspondiente.</li>
                <li>Descripción clara y detallada de los datos sobre los cuales busca ejercer alguno de los derechos ARCO y la petición concreta (ej. &quot;Deseo cancelar mi cuenta y que se elimine todo el historial asociado a mi número telefónico&quot;).</li>
              </ol>
              <p className="text-xs text-neutral-500 mt-2">
                El área legal evaluará la procedencia de la solicitud en un plazo de <strong>15 días hábiles</strong> contados a partir de la recepción y confirmación de su identidad, notificándole la resolución vía correo electrónico.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">6. Uso de Cookies y Tecnologías de Rastreo</h2>
              <p>
                Nuestra plataforma utiliza herramientas de almacenamiento local (<code>localStorage</code>) y cookies técnicas esenciales para mantener activa su sesión de usuario, registrar sus preferencias de dirección de entrega habitual y optimizar la velocidad de carga de las imágenes de los menús. Estas herramientas son de índole funcional y no rastrean su actividad en páginas web externas ajenas a SaDeL.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">7. Medidas de Seguridad</h2>
              <p>
                SaDeL cuenta con medidas de seguridad administrativas, técnicas y físicas equivalentes a las exigidas por las multinacionales más avanzadas para proteger sus datos personales contra daño, pérdida, alteración, destrucción o el uso, acceso o tratamiento no autorizado. Entre estas medidas se incluyen protocolos de cifrado SSL/TLS de 256 bits para el tránsito de información y firewalls de red.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">8. Cambios al Aviso de Privacidad</h2>
              <p>
                El presente aviso de privacidad puede sufrir modificaciones, cambios o actualizaciones derivadas de nuevos requerimientos legales, de nuestras propias necesidades operativas o de mejoras tecnológicas. SaDeL informará de manera oportuna a los usuarios de cualquier modificación sustancial mediante un aviso destacado en el portal web.
              </p>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
