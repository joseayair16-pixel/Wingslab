import { AppError } from '../errors/app-error';

export type InPersonSaleItemInput = {
  productId: string;
  quantity: number;
  weightG?: number;
  optionIds?: string[];
};

export type InPersonCatalogProduct = {
  id: string;
  name: string;
  price: number;
  discountPrice: number | null;
  promoType: string | null;
  promoBuyQuantity: number | null;
  promoPayQuantity: number | null;
  sellBy: string;
  unitPrice: number | null;
  minWeightG: number | null;
  maxWeightG: number | null;
  stepWeightG: number | null;
  trackStock: boolean;
  stock: number;
  isAvailable: boolean;
  deleted: boolean;
  isAdultOnly: boolean;
  optionGroups: Array<{ id: string; name: string; minSelection: number; maxSelection: number; options: Array<{ id: string; name: string; price: number; isAvailable: boolean }> }>;
};

export type InPersonSaleItemSnapshot = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  sellBy: 'UNIT' | 'WEIGHT';
  weightG: number | null;
  optionIds: string[];
  options: Array<{ id: string; name: string; priceCents: number }>;
  promotionApplied: boolean;
  stockDeducted: boolean;
};

export function calculateInPersonSaleItems(input: InPersonSaleItemInput[], catalog: InPersonCatalogProduct[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new AppError(400, 'INVALID_SALE_ITEMS', 'Agrega entre 1 y 50 productos a la venta.');
  }
  const byId = new Map(catalog.map(product => [product.id, product]));
  const stockRequired = new Map<string, number>();
  const totalUnitQuantity = new Map<string, number>();
  for (const line of input) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new AppError(400, 'INVALID_QUANTITY', 'La cantidad debe ser de 1 a 100 unidades.');
    }
    const product = byId.get(line.productId);
    if (product?.sellBy === 'UNIT') totalUnitQuantity.set(product.id, (totalUnitQuantity.get(product.id) ?? 0) + line.quantity);
  }
  const freeQuantityRemaining = new Map<string, number>();
  for (const [productId, quantity] of totalUnitQuantity) {
    const product = byId.get(productId)!;
    const buy = product.promoBuyQuantity ?? 0;
    const pay = product.promoPayQuantity ?? 0;
    if (product.promoType === 'MULTI_BUY' && buy > 0 && pay > 0 && pay < buy) {
      const paid = Math.floor(quantity / buy) * pay + quantity % buy;
      freeQuantityRemaining.set(productId, quantity - paid);
    }
  }
  const items: InPersonSaleItemSnapshot[] = input.map(line => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new AppError(400, 'INVALID_QUANTITY', 'La cantidad debe ser de 1 a 100 unidades.');
    }
    const product = byId.get(line.productId);
    if (!product || !product.isAvailable || product.deleted) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Uno de los productos ya no está disponible. Actualiza el catálogo.');
    if (product.isAdultOnly) throw new AppError(409, 'ADULT_PRODUCT_NOT_ALLOWED', 'Los productos para mayores de edad no pueden registrarse en esta venta de fidelidad.');
    const optionIds = line.optionIds || [];
    if (new Set(optionIds).size !== optionIds.length) throw new AppError(400, 'INVALID_OPTIONS', 'No repitas opciones del producto.');
    const validOptions = product.optionGroups.flatMap(group => group.options);
    if (optionIds.some(id => !validOptions.some(option => option.id === id))) throw new AppError(400, 'INVALID_OPTIONS', `Las opciones de ${product.name} no son válidas.`);
    const options: InPersonSaleItemSnapshot['options'] = [];
    for (const group of product.optionGroups) {
      const chosen = optionIds.filter(id => group.options.some(option => option.id === id));
      if (chosen.length < group.minSelection || chosen.length > group.maxSelection) {
        throw new AppError(400, 'INVALID_OPTIONS', `Revisa las opciones requeridas para ${product.name}: ${group.name}.`);
      }
      for (const id of chosen) {
        const option = group.options.find(candidate => candidate.id === id)!;
        if (!option.isAvailable) throw new AppError(409, 'OPTION_UNAVAILABLE', `Una opción de ${product.name} ya no está disponible.`);
        options.push({ id, name: option.name, priceCents: Math.round(option.price * 100) });
      }
    }

    const sellBy = product.sellBy === 'WEIGHT' ? 'WEIGHT' : product.sellBy === 'UNIT' ? 'UNIT' : null;
    if (!sellBy) throw new AppError(409, 'PRODUCT_NOT_SELLABLE', `${product.name} no se puede vender desde esta caja.`);
    const optionPriceCents = options.reduce((sum, option) => sum + option.priceCents, 0);
    const promotionApplied = product.discountPrice !== null || product.promoType !== null;
    let subtotalCents: number;
    let weightG: number | null = null;
    if (sellBy === 'WEIGHT') {
      weightG = line.weightG ?? 0;
      const min = product.minWeightG ?? 100;
      const max = product.maxWeightG ?? 5000;
      const step = product.stepWeightG ?? 100;
      if (!Number.isSafeInteger(weightG) || weightG < min || weightG > max || (weightG - min) % step !== 0) {
        throw new AppError(400, 'INVALID_WEIGHT', `El peso de ${product.name} debe estar entre ${min}g y ${max}g, en incrementos de ${step}g.`);
      }
      const pricePerKgCents = Math.round((product.discountPrice ?? product.unitPrice ?? product.price) * 100);
      subtotalCents = Math.round(pricePerKgCents * weightG * line.quantity / 1000) + optionPriceCents * line.quantity;
    } else {
      const unitPriceCents = Math.round((product.discountPrice ?? product.price) * 100);
      const freeForLine = Math.min(line.quantity, freeQuantityRemaining.get(product.id) ?? 0);
      const paidQuantity = line.quantity - freeForLine;
      if (freeForLine) freeQuantityRemaining.set(product.id, (freeQuantityRemaining.get(product.id) ?? 0) - freeForLine);
      subtotalCents = unitPriceCents * paidQuantity + optionPriceCents * line.quantity;
      if (product.trackStock) stockRequired.set(product.id, (stockRequired.get(product.id) ?? 0) + line.quantity);
    }
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new AppError(400, 'INVALID_SALE_TOTAL', 'No se pudo calcular el precio del producto.');
    return {
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
      unitPriceCents: Math.round(subtotalCents / line.quantity),
      subtotalCents,
      sellBy,
      weightG,
      optionIds,
      options,
      promotionApplied,
      stockDeducted: sellBy === 'UNIT' && product.trackStock,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 100_000_000) throw new AppError(400, 'INVALID_SALE_TOTAL', 'El total de la venta supera el límite permitido.');
  return { items, subtotalCents, hasPromotion: items.some(item => item.promotionApplied), stockRequired };
}
