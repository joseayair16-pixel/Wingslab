# Criterios de salida a producción

Validar en un entorno de ensayo con la misma configuración de red y despliegue que producción, usando cuentas y datos de prueba. No publicar si falla un flujo crítico.

| Área | Evidencia requerida |
| --- | --- |
| Reinicio | Mantener ambos paneles conectados durante un reinicio. Comprobar que el proceso anterior termina, el tráfico vuelve al backend y las sesiones y sockets se recuperan sin recargar manualmente. |
| Flujo de pedidos | Crear, aceptar, preparar, marcar listo y completar un pedido; probar un rechazo por separado. Comprobar persistencia, ausencia de duplicados y que cada rol solo ve sus pedidos. |
| Web Push | Confirmar aviso de pedido nuevo al restaurante y rechazo al comensal con el panel abierto y cerrado. Probar PWA con pantalla bloqueada, cambio de cuenta y cierre de sesión. Registrar sistema, navegador y dispositivo; la aceptación del proveedor no confirma recepción. |
| Degradación | Simular una interrupción breve de backend y Redis en ensayo. Comprobar que la interfaz no presenta datos desactualizados como actuales y que recupera el estado al reconectar. |
| Operación | Configurar alertas por errores 5xx sostenidos, reinicios y fallos de envío. Verificar copia y restauración de datos y documentar cómo volver a la versión anterior sin perder pedidos. |

Registrar versión, entorno y resultado de cada comprobación antes de aprobar la publicación. La validación local no sustituye estas pruebas.
