-- Eliminación del campo preparationTime del modelo Product.
-- El tiempo de preparación ahora se maneja a nivel de pedido (preparationTimeMinutes).
ALTER TABLE "Product" DROP COLUMN "preparationTime";
