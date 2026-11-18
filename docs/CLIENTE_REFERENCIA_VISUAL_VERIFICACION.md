# Cliente WingsLab — implementación de la referencia visual

## Resultado desplegado

URL: <http://127.0.0.1:3103>.

Imagen local: `wingslab-customer:menu-content-20261115-official-reference-r4`.
SHA: `37789094ea2f43799d564967c69339bb4ab34fd1ef96e2d9afbf0ec995e17ed0`.

Se reutilizaron el catálogo, las funciones de carrito/personalización y el componente de promociones existentes. No se sustituyeron por una maqueta.

- Encabezado rojo sólido `#F20D12`, logotipo original de `docs/Logotipo wings.png`, centrado, y carrito Lucide con contador real. No se reproduce la barra del sistema operativo.
- Carrusel conectado a `/public/menu-content` y `/public/menu-images/:id`: imágenes sin duplicar sus títulos, indicadores, scroll-snap táctil, avance pausado durante interacción y sin avance automático con movimiento reducido.
- Destacados derivados de descuentos y promociones por cantidad realmente configurados. No se utiliza publicidad multirrestaurante.
- Categorías del backend con iconografía Lucide y selección/desplazamiento funcional.
- Tarjetas verticales de dos columnas en los tres teléfonos y tres columnas en escritorio. Fotografía arriba, nombre, descripción limitada, precio y acción de carrito. Se conservan precios, descuentos, opciones, cantidades y stock; los productos no disponibles no se pueden agregar.
- Cápsula flotante: Inicio, Pedidos, Promos, Cuenta y Más. Más abre un diálogo nativo con búsqueda, información, horarios y enlaces legales.
- Tema oscuro del catálogo con fondo `#101012`, sin inversión de imágenes y sin cambiar el sistema de persistencia existente.

## Capturas del sitio con datos reales

- [Móvil claro, 390 × 844](evidence/customer-reference/390-light.png)
- [Móvil oscuro, 390 × 844](evidence/customer-reference/390-dark.png)
- [Escritorio claro, 1440 × 1000](evidence/customer-reference/desktop-light.png)
- [Escritorio oscuro, 1440 × 1000](evidence/customer-reference/desktop-dark.png)
- [Carrito oscuro](evidence/customer-reference/375-dark-cart.png)
- [Checkout autenticado de solo lectura](evidence/customer-reference/390-dark-checkout-readonly.png)

También se guardaron las variantes 375 × 812 y 430 × 932, en claro y oscuro, en la misma carpeta.

## Comparación visual y límites de fidelidad

[Comparación a un mismo ancho de 390 px](evidence/customer-reference/comparison-390.png).

La comparación distingue tres columnas: referencia aprobada, aplicación con datos reales y prueba aislada con contenido interceptado. En la referencia se recortó la barra de estado dibujada; no se agregó a la aplicación. Se conserva la escala horizontal, no se deforma la referencia para igualar la altura del teléfono de prueba.

Después de la primera captura se redujeron la altura del encabezado, la proporción de las imágenes de producto, las tarjetas de destacados, el espacio entre secciones y la altura de las categorías. Se corrigió además la colisión del precio anterior con el botón de carrito.

**No es una reproducción píxel por píxel ni se certifica una coincidencia fotográfica completa.** Las diferencias reales son:

1. El catálogo local tiene tres productos, una categoría y ninguna fotografía, promoción de producto o banner activo. Se muestran estados vacíos y fotografías no disponibles; no se publicaron los productos ni las ofertas de la referencia.
2. Textos, tarjetas y navegación son más altos que la referencia escalada a 390 px para conservar legibilidad y controles principales de 44 px. Las categorías pueden desplazarse en lugar de comprimir todos sus nombres en una sola pantalla.
3. Las superficies rojas con etiquetas pequeñas utilizan `#BB0A0E`, para contraste con blanco; el encabezado y los acentos gráficos conservan `#F20D12`.
4. No se muestran favoritos porque no existe una función real conectada. Los iconos de categorías pertenecen a Lucide; no son dibujos personalizados extraídos de la referencia.
5. Escritorio utiliza tres columnas y un banner de ancho limitado, no una ampliación arbitraria de la pantalla móvil.

Las imágenes de comida recortadas de la referencia se emplearon **exclusivamente en respuestas interceptadas del navegador de prueba**. No están en el catálogo, la configuración del restaurante, los assets servidos por la aplicación ni la imagen Docker publicada. Las capturas correspondientes se llaman `fixture-…-NOT-REAL-CONTENT.png` y no deben confundirse con contenido real disponible al abrir el sitio.

## Verificaciones ejecutadas

Chrome local, perfiles aislados, orígenes externos bloqueados. No se usaron sesiones personales del navegador.

| Comprobación | Resultado |
| --- | --- |
| 375 × 812, 390 × 844, 430 × 932, 1440 × 1000; claro/oscuro | 8 combinaciones aprobadas |
| Logo cargado, encabezado opaco y rojo, dos columnas móviles, sin scroll horizontal | Aprobado |
| Agregar producto real, contador y carrito visible | Aprobado en las 8 combinaciones |
| Checkout de visitante exige autenticación | Aprobado en las 8 combinaciones |
| Checkout autenticado realmente visible, sin enviar pedido | Aprobado en las 8 combinaciones |
| Más, cierre con Escape, búsqueda y separación final de productos respecto a la cápsula | Aprobado |
| Preferencia clara prevalece sobre sistema oscuro; Sistema reacciona al cambio | Aprobado |
| Banners válidos, indicadores y gesto táctil horizontal | Aprobado con fixtures aislados |
| Opciones obligatorias bloquean Agregar; selección habilita la acción y suma el complemento | Aprobado con fixtures, claro/oscuro |
| Productos no disponibles y stock cero | Agregar deshabilitado con fixtures |
| Inicio/Promos y categorías extensas | Aprobado con fixtures |
| Vacío, error con Reintentar y carga con recuperación | Aprobado con fixtures |
| Compilación de producción y TypeScript | Aprobado |
| `git diff --check` | Aprobado |

Las comprobaciones de checkout verifican posición y `pointer-events` del panel, no solamente textos de elementos ocultos del DOM. El JWT de prueba se generó localmente para el usuario de lectura existente, sin iniciar sesión ni crear registros de sesión. No se imprimieron credenciales.

No se envió ningún pedido ni se activaron pagos, push, SMS o WhatsApp. No se modificó la base, no se ejecutaron migraciones y no se recrearon PostgreSQL/Redis. Backend saludable al cierre. Espacio libre del host al cierre: aproximadamente 20 GiB. No hubo commit ni push.

### Alcance pendiente

- Cargar fotografías/banners/promociones autorizados desde la gestión existente y repetir la comparación con ese contenido real. Esta fase no escribió contenido en la base.
- Verificación física de Safari/iOS y Android con teclado y safe areas reales: se verificaron viewports y gestos emulados en Chrome, no dispositivos físicos.
- No se repitió en esta fase la aplicación de un cupón ni el envío final de un pedido; su lógica no fue rediseñada.
- El panel del restaurante y la vista de reparto no fueron objeto de esta implementación de la referencia del menú.

## Repetición

```sh
python3 scripts/deploy-customer-reference.py customer <sufijo-unico>
node scripts/check-customer-reference.cjs
node scripts/check-customer-reference-fixtures.cjs
node scripts/check-customer-reference-checkout.cjs
```

El helper de despliegue está restringido al cliente, compila offline con dependencias locales y conserva los contenedores de datos. Los scripts de navegador bloquean escrituras; los fixtures no se envían al backend. La preparación de recortes de prueba requiere Pillow local, ya disponible en este entorno. Los perfiles y contextos de compilación quedan bajo `tmp/` dentro de WingsLab.
