'use client';

import Link from 'next/link';
import { SaDelLogo } from '../../components/SaDelLogo';

export default function TermsPage() {
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
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
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
            <h1 className="text-3xl font-extrabold tracking-tight text-neutral-950 md:text-4xl">Términos y Condiciones de Uso</h1>
            <p className="text-xs text-neutral-400 font-semibold mt-2 font-mono">Última actualización: 15 de junio de 2026</p>
          </div>

          <div className="space-y-6 text-sm text-neutral-600 leading-relaxed font-medium">
            
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">1. Declaraciones preliminares y aceptación de los términos</h2>
              <p>
                El presente documento establece los Términos y Condiciones de Uso (en lo sucesivo, los <strong>&quot;Términos&quot;</strong>) que regulan el acceso y uso de la plataforma tecnológica SaDeL, propiedad de <strong>SAD SERVICES & DELIVERY LAB, S. DE R.L. DE C.V.</strong> (en lo sucesivo, <strong>&quot;SaDeL&quot;</strong>), por parte de cualquier persona que acceda como usuario comensal (en adelante, el <strong>&quot;Usuario&quot;</strong>).
              </p>
              <p>
                Al acceder, navegar o utilizar la plataforma, el Usuario manifiesta su consentimiento expreso y adhesión a los presentes Términos. Si el Usuario no está de acuerdo con estos Términos, deberá abstenerse de utilizar los servicios de la plataforma de forma inmediata.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">2. Naturaleza jurídica de los servicios (Intermediación Tecnológica)</h2>
              <p>
                El Usuario reconoce y acepta que SaDeL es únicamente un <strong>intermediario tecnológico</strong>. La plataforma proporciona una infraestructura digital que conecta a tres partes independientes:
              </p>
              <ul className="list-disc list-inside pl-2 space-y-1">
                <li>El <strong>Usuario</strong> que solicita la orden.</li>
                <li>El <strong>Establecimiento Aliado</strong> (Restaurante), ente mercantil independiente que prepara los alimentos.</li>
                <li>El <strong>Socio Repartidor Independiente</strong>, proveedor logístico autónomo encargado del traslado físico de los productos.</li>
              </ul>
              <p className="bg-amber-50 border border-amber-100 p-4 rounded-2xl text-xs text-amber-900 mt-2">
                <strong>Cláusula de Exención de Responsabilidad por Alimentos y Logística:</strong> SaDeL no prepara alimentos, no comercializa productos de consumo de manera directa, ni actúa como empleador o patrón de los Socios Repartidores. En consecuencia, el Establecimiento Aliado es el único responsable de la calidad, ingredientes, higiene y presentación de la comida. Asimismo, el Socio Repartidor es el único responsable del cumplimiento de las leyes de tránsito y de cualquier incidente vial ocurrido durante el reparto.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">3. Uso de la cuenta y seguridad</h2>
              <p>
                Para realizar pedidos en la plataforma, el Usuario debe registrarse y mantener una cuenta activa. El Usuario es el único responsable de mantener la confidencialidad de sus credenciales de acceso y de su código NIP de seguridad para la entrega de pedidos.
              </p>
              <p>
                Cualquier actividad realizada a través de la cuenta del Usuario se presumirá efectuada por este, asumiendo cualquier responsabilidad derivada de transacciones, cargos o reclamos.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">4. Precios, tarifas de envío y facturación</h2>
              <p>
                Los precios de los platillos mostrados en la plataforma son fijados directamente por los Establecimientos Aliados y pueden diferir de los precios físicos en sucursal. Adicionalmente, se desglosará una tarifa de envío basada en la distancia (geolocalización) y factores de demanda.
              </p>
              <p>
                En caso de requerir factura fiscal por el consumo de sus alimentos, el Usuario deberá solicitarla directamente al Establecimiento Aliado (Restaurante), adjuntando su ticket de compra. SaDeL únicamente facturará las tarifas operativas de servicio en caso de que estas existan y sean cobradas directamente por la plataforma.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">5. Política de cancelación, devoluciones y reembolsos</h2>
              <p>
                Dada la naturaleza perecedera de los alimentos preparados, las políticas de cancelación se regulan bajo las siguientes reglas:
              </p>
              <div className="space-y-3 pl-4 border-l-2 border-neutral-100 mt-2">
                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">A. Cancelaciones por el Usuario:</h3>
                  <p>
                    Una vez que el pedido ha sido aceptado por el Establecimiento Aliado y ha comenzado su preparación, no se admiten cancelaciones ni se realizarán reembolsos al Usuario.
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">B. Pedidos no entregados por ausencia del cliente:</h3>
                  <p>
                    Si el Socio Repartidor arriba a la ubicación de entrega señalada por el Usuario y éste no responde o no está disponible tras un tiempo de espera de 10 (diez) minutos y habiendo realizado al menos 2 intentos de contacto telefónico/chat, el pedido se marcará como &quot;Entregado con Incidencia&quot;. En este caso, no habrá reembolso alguno y el cobro de la orden se ejecutará en su totalidad.
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider">C. Reclamaciones por platillos erróneos o faltantes:</h3>
                  <p>
                    Cualquier reclamación sobre la preparación, ingredientes incorrectos o platillos faltantes deberá canalizarse mediante el Centro de Ayuda en un plazo no mayor a 2 horas tras la entrega. SaDeL intermediará la resolución con el Restaurante y determinará si procede una compensación o reembolso conforme a la evidencia proporcionada.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">6. Limitación de responsabilidad por fallas técnicas</h2>
              <p>
                SaDeL se esfuerza por mantener la plataforma activa las 24 horas del día. Sin embargo, los servicios se proporcionan &quot;tal cual&quot; y &quot;sujetos a disponibilidad&quot;. SaDeL no garantiza que la plataforma esté libre de interrupciones, retrasos por fallas de internet, caídas de servidores o latencias de comunicación WebSocket. 
              </p>
              <p>
                SaDeL no será responsable por daños incidentales, consecuentes o pérdidas comerciales derivadas del uso de la plataforma o de la imposibilidad técnica de acceder a la misma.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">7. Propiedad intelectual</h2>
              <p>
                Todos los derechos de propiedad intelectual sobre el código fuente, la base de datos, las interfaces gráficas, los logotipos, las marcas registradas, el sonido de las notificaciones y el diseño general de la plataforma SaDeL son propiedad exclusiva de SaDeL. Queda estrictamente prohibida la reproducción, copia, distribución, ingeniería inversa o cualquier explotación comercial no autorizada por escrito de dichos activos.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-950 uppercase tracking-wide">8. Jurisdicción y legislación aplicable</h2>
              <p>
                Para la interpretación, cumplimiento y resolución de cualquier controversia derivada de los presentes Términos, las partes se someten expresamente a las leyes federales de los Estados Unidos Mexicanos y a los tribunales de la ciudad de Morelia, Michoacán de Ocampo, renunciando expresamente a cualquier otro fuero o jurisdicción que pudiera corresponderles por razón de sus domicilios presentes o futuros.
              </p>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
