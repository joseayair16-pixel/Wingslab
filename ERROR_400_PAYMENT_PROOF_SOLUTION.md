# 🔧 Solución: Error 400 al Crear Pedidos (Payment Proof Missing)

## 📋 Diagnóstico

### El Problema
El frontend enviaba requests POST a `/pedidos` sin el campo `paymentProofUrl` cuando el usuario seleccionaba **TRANSFER** como método de pago. El backend rechazaba con **400 Bad Request** porque:

```typescript
// Schema del backend - order.routes.ts
superRefine((data, context) => {
  if (data.paymentMethod === PaymentMethod.TRANSFER && !data.paymentProofUrl?.trim()) {
    context.addIssue({
      message: 'El comprobante de transferencia es obligatorio.',
      path: ['paymentProofUrl'],
    });
  }
});
```

### Síntomas
- POST `/pedidos` retorna 400 cuando se intenta crear un pedido
- Error se repite múltiples veces (indicaba que el usuario intentaba varias veces)
- Afectaba a usuarios que seleccionaban "Transferencia" como método de pago

---

## ✅ Solución Implementada

### 1. **Agregar Estados para el Comprobante** (Línea 374-376)
```typescript
const [paymentProofUrl, setPaymentProofUrl] = useState('');
const [paymentProofUploading, setPaymentProofUploading] = useState(false);
```

### 2. **Nueva Función: `handlePaymentProofUpload()`** (Línea 1443-1490)
Maneja la subida del comprobante:
- ✅ Valida tamaño máximo (5MB)
- ✅ Valida tipo de archivo (JPG, PNG, WebP, PDF)
- ✅ Convierte a Data URL
- ✅ Usa `uploadMediaAsset()` para subirlo al servidor
- ✅ Almacena URL en estado
- ✅ Muestra feedback visual al usuario

```typescript
async function handlePaymentProofUpload(file: File) {
  // Validaciones
  // Lectura del archivo
  // Subida a través de uploadMediaAsset()
  // Actualización del estado
}
```

### 3. **Validación Antes de Crear Pedido** (Línea 1378-1383)
Valida que se haya subido el comprobante si es TRANSFER:
```typescript
if (paymentMethod === 'TRANSFER' && !paymentProofUrl.trim()) {
  setToastMessage('Por favor, sube el comprobante de transferencia.');
  return;
}
```

### 4. **Envío de `paymentProofUrl` en Payload** (Línea 1415)
Ahora el POST incluye el comprobante:
```typescript
body: JSON.stringify({
  // ... otros campos
  paymentMethod: paymentMethod,
  paymentProofUrl: paymentMethod === 'TRANSFER' ? paymentProofUrl : undefined,
  // ...
})
```

### 5. **UI para Subir Comprobante** (Línea 3742-3773)
Campo visible solo cuando TRANSFER está seleccionado:
```jsx
{paymentMethod === 'TRANSFER' && (
  <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50">
    <label className="block">
      <p className="text-sm font-semibold text-neutral-800 mb-2">
        📄 Comprobante de Transferencia
      </p>
      <input
        type="file"
        accept="image/*,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handlePaymentProofUpload(file);
        }}
      />
    </label>
  </div>
)}
```

---

## 🎯 Flujo de Trabajo Después de la Solución

### Para Efectivo (CASH)
1. Usuario selecciona "Efectivo"
2. ❌ Campo de comprobante NO aparece
3. ✅ Puede crear pedido sin restricciones

### Para Transferencia (TRANSFER)
1. Usuario selecciona "Transferencia"
2. ✅ Aparece campo para subir comprobante
3. 📤 Usuario sube imagen/PDF del comprobante
4. ✅ Sistema valida archivo (tipo + tamaño)
5. 🚀 Se sube a servidor mediante `uploadMediaAsset()`
6. ✅ URL se almacena en `paymentProofUrl`
7. 🟢 Botón "Confirmar Pedido" habilitado
8. ✅ POST `/pedidos` incluye `paymentProofUrl` válida
9. ✅ Backend valida y crea pedido

---

## 🔍 Cambios Realizados

### Archivo: `packages/web-customer/src/app/page.tsx`

| Línea | Cambio | Descripción |
|-------|--------|-------------|
| 374-376 | Estados nuevos | `paymentProofUrl` y `paymentProofUploading` |
| 1378-1383 | Validación | Rechaza TRANSFER sin comprobante |
| 1415 | Payload POST | Incluye `paymentProofUrl` |
| 1443-1490 | Nueva función | `handlePaymentProofUpload()` |
| 3742-3773 | UI condicional | Campo para subir comprobante |

---

## ✨ Validaciones Implementadas

### En el Frontend
- ✅ Archivo obligatorio si paymentMethod = TRANSFER
- ✅ Tamaño máximo: 5MB
- ✅ Tipos permitidos: JPG, PNG, WebP, PDF
- ✅ Feedback visual mientras se sube
- ✅ Botón para remover comprobante

### En el Backend (ya existía)
- ✅ URL válida según Zod schema
- ✅ Rechaza POST si TRANSFER sin paymentProofUrl
- ✅ Rechaza si paymentProofUrl no es URL válida

---

## 🧪 Cómo Probar

### Test 1: Pedido con Efectivo (SIN comprobante)
1. Ir a checkout
2. Seleccionar "Efectivo"
3. ❌ NO debe aparecer campo de comprobante
4. ✅ Crear pedido sin cargar archivo
5. ✅ Pedido debe crearse exitosamente

### Test 2: Pedido con Transferencia (CON comprobante)
1. Ir a checkout
2. Seleccionar "Transferencia"
3. ✅ Aparece campo para subir comprobante
4. 📤 Subir imagen de comprobante (JPG/PNG/PDF)
5. ✅ Debe mostrar "Comprobante subido"
6. 🟢 Crear pedido
7. ✅ Pedido debe crearse exitosamente

### Test 3: Error - Transferencia sin comprobante
1. Ir a checkout
2. Seleccionar "Transferencia"
3. ❌ NO subir ningún archivo
4. Intentar crear pedido
5. ✅ Debe mostrar toast: "Por favor, sube el comprobante de transferencia."

### Test 4: Error - Archivo inválido
1. Seleccionar "Transferencia"
2. Intentar subir archivo que NO sea imagen/PDF
3. ✅ Debe mostrar toast: "Solo se aceptan imágenes (JPG, PNG, WebP) o PDF."

### Test 5: Error - Archivo muy grande
1. Seleccionar "Transferencia"
2. Intentar subir archivo > 5MB
3. ✅ Debe mostrar toast: "El archivo es demasiado grande. Máximo 5MB."

---

## 🚀 Resultado Esperado

Después de estos cambios:

| Escenario | Antes | Después |
|-----------|-------|---------|
| Pedido CASH | ✅ Funciona | ✅ Funciona |
| Pedido TRANSFER sin comprobante | ❌ Error 400 | ✅ Validación frontend |
| Pedido TRANSFER con comprobante | ❌ No se enviaba | ✅ Se envía URL válida |
| Archivo inválido | ❌ Error 400 | ✅ Validación antes de subir |

---

## 📝 Notas Importantes

1. **`uploadMediaAsset()` ya existía** - Reutilizamos la función de `@sadel/shared`
2. **Backend ya validaba correctamente** - Solo faltaba que el frontend enviara datos
3. **API de subida funciona** - El servidor tiene endpoint `/uploads` configurado
4. **Feedback visual** - Toast messages guían al usuario en el proceso
5. **Fallback a Data URL** - Si la subida falla, se usa el data URL como fallback

---

## 🔗 Dependencias

- ✅ `uploadMediaAsset()` from `@sadel/shared`
- ✅ File API (FileReader)
- ✅ React hooks (useState)
- ✅ Backend endpoint: POST `/pedidos` con validación Zod

---

## ✅ QA Checklist

- [x] Sin errores TypeScript
- [x] Validaciones en frontend
- [x] Feedback visual al usuario
- [x] Archivo se carga correctamente
- [x] URL se envía en payload
- [x] Backend valida correctamente
- [x] Manejo de errores completo
- [x] Responsivo en móvil/desktop
