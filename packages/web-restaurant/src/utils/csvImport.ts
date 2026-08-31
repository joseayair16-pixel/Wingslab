export type ImportFieldKey =
  | 'name'
  | 'price'
  | 'category'
  | 'sellBy'
  | 'description'
  | 'discountPrice'
  | 'image';

export type CsvDelimiter = ',' | ';' | '\t';

export const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> = {
  name: 'Nombre',
  price: 'Precio',
  category: 'Categoría',
  sellBy: 'Tipo de venta',
  description: 'Descripción',
  discountPrice: 'Precio especial',
  image: 'Imagen (URL)',
};

export const IMPORT_FIELD_ORDER: ImportFieldKey[] = [
  'name',
  'price',
  'category',
  'sellBy',
  'description',
  'discountPrice',
  'image',
];

/**
 * Palabras clave para autodetección de columnas. Cada sinónimo se normaliza de
 * la misma forma que los encabezados antes de comparar, para que variantes con
 * acentos, guiones, guiones bajos o espacios múltiples matcheen igual.
 */
export const IMPORT_COLUMN_KEYWORDS: Record<ImportFieldKey, string[]> = {
  name: [
    'name',
    'nombre',
    'nombre del producto',
    'nombre producto',
    'producto',
    'platillo',
    'plato',
    'item',
    'articulo',
    'articulo del producto',
    'product name',
    'dish',
  ],
  price: [
    'price',
    'precio',
    'precio pieza',
    'precio por pieza',
    'costo',
    'importe',
    'costo unitario',
    'precio unitario',
    'precio del producto',
  ],
  category: [
    'category',
    'categoria',
    'categoria del producto',
    'categoria producto',
    'seccion',
    'categoria menu',
    'grupo',
  ],
  sellBy: [
    'tipo',
    'tipo de venta',
    'tipo venta',
    'venta',
    'sell by',
    'unidad',
    'unidad de venta',
    'unidad venta',
    'peso',
    'por peso',
    'medida',
    'sale type',
  ],
  description: [
    'description',
    'descripcion',
    'descripcion del producto',
    'descripcion producto',
    'detalle',
    'detalles',
    'detalle del producto',
    'des',
    'desc',
  ],
  discountPrice: [
    'precio especial',
    'precio promocional',
    'precio promo',
    'precio oferta',
    'descuento',
    'discount',
    'discount price',
    'oferta',
    'promo price',
  ],
  image: [
    'image',
    'imagen',
    'imagen url',
    'imagen url',
    'url imagen',
    'foto',
    'foto url',
    'url',
    'imagen del producto',
  ],
};

/**
 * Normaliza un encabezado para comparar de forma robusta:
 * - recorta espacios
 * - elimina acentos/diacríticos (NFD)
 * - pasa a minúsculas
 * - colapsa cualquier separador (guiones, guiones bajos, espacios múltiples,
 *   puntuación) a un único guion bajo
 *
 * 'Precio', 'precio', ' PRECIO ', 'precio_producto', 'precio-producto' y
 * 'precio  del producto' convergen a 'precio_del_producto'.
 */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Normaliza una palabra clave de la misma forma que los encabezados. */
export function normalizeKeyword(text: string): string {
  return normalizeHeader(text);
}

/** Conjunto de palabras clave normalizadas por campo (computado una sola vez). */
const NORMALIZED_KEYWORDS: Record<ImportFieldKey, string[]> = (() => {
  const result: Record<ImportFieldKey, string[]> = {
    name: [],
    price: [],
    category: [],
    sellBy: [],
    description: [],
    discountPrice: [],
    image: [],
  };
  (Object.keys(IMPORT_COLUMN_KEYWORDS) as ImportFieldKey[]).forEach((field) => {
    result[field] = IMPORT_COLUMN_KEYWORDS[field].map(normalizeKeyword);
  });
  return result;
})();

/**
 * Detecta si la primera fila de un CSV pegado parece un encabezado.
 * Compara contra las palabras clave normalizadas.
 */
export function detectCsvHeaderRow(firstRow: string[]): boolean {
  const normalizedCells = firstRow.map(normalizeHeader).filter(Boolean);
  return normalizedCells.some((cell) =>
    (Object.keys(NORMALIZED_KEYWORDS) as ImportFieldKey[]).some((field) =>
      NORMALIZED_KEYWORDS[field].some((kw) => kw.length > 0 && cell === kw)
    )
  );
}

function sameOrContains(cell: string, kw: string): boolean {
  if (cell === kw) return true;
  if (kw.length < 2) return false;
  // Permite variantes compuestas como "precio del producto" cuando la palabra
  // clave es un subconjunto completo del encabezado normalizado.
  return cell.includes(kw);
}

function findBestIndexForField(
  normalizedCells: string[],
  keywords: string[],
  usedIndices: Set<number>
): number | undefined {
  // 1) Coincidencia exacta
  for (let i = 0; i < normalizedCells.length; i += 1) {
    const cell = normalizedCells[i];
    if (usedIndices.has(i) || cell.length === 0) continue;
    if (keywords.some((kw) => kw.length > 0 && cell === kw)) return i;
  }
  // 2) Coincidencia por "contiene" (variantes compuestas)
  for (let i = 0; i < normalizedCells.length; i += 1) {
    const cell = normalizedCells[i];
    if (usedIndices.has(i) || cell.length === 0) continue;
    if (keywords.some((kw) => kw.length >= 2 && sameOrContains(cell, kw))) return i;
  }
  return undefined;
}

/**
 * Mapea automáticamente las columnas de un encabezado a los campos del
 * importador. Prioriza coincidencias exactas y de "contiene" sobre palabras
 * clave normalizadas, sin asignar dos campos a la misma columna.
 */
export function autoMapImportColumns(headerRow: string[]): Record<ImportFieldKey, number | undefined> {
  const map: Record<ImportFieldKey, number | undefined> = {
    name: undefined,
    price: undefined,
    category: undefined,
    sellBy: undefined,
    description: undefined,
    discountPrice: undefined,
    image: undefined,
  };

  if (headerRow.length === 0) {
    map.name = 0;
    map.price = 1;
    return map;
  }

  const normalizedCells = headerRow.map(normalizeHeader);
  const usedIndices = new Set<number>();

  const fields = Object.keys(NORMALIZED_KEYWORDS) as ImportFieldKey[];
  fields.forEach((field) => {
    const index = findBestIndexForField(normalizedCells, NORMALIZED_KEYWORDS[field], usedIndices);
    if (index !== undefined) {
      map[field] = index;
      usedIndices.add(index);
    }
  });

  // Fallback por posición si no se detectó encabezado: asume orden por defecto.
  if (map.name === undefined) map.name = 0;
  if (map.price === undefined) map.price = map.name === 0 ? 1 : 0;

  return map;
}

/**
 * Detecta el separador de un texto CSV contando ocurrencias en una muestra.
 * Prioriza el separador más abundante; por defecto la coma.
 */
export function guessCsvDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 4000);
  const commaCount = (sample.match(/,/g) || []).length;
  const semicolonCount = (sample.match(/;/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  if (semicolonCount > commaCount && semicolonCount > 0) return ';';
  if (tabCount > commaCount && tabCount > 0) return '\t';
  return ',';
}

/**
 * Parser CSV manual: respeta comillas dobles y comillas escapadas (""), CRLF,
 * y descarta filas vacías.
 */
export function parseCsvRows(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(current);
    current = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (field.trim() !== '' || current.length > 0) pushRow();
    } else {
      field += char;
    }
  }
  if (field.trim() !== '' || current.length > 0) pushRow();

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

/**
 * Normaliza un valor de precio de celda al formato numérico esperado,
 * respetando el separador decimal según el delimitador del CSV.
 */
export function parseImportPrice(cell: string, delimiter: CsvDelimiter): number | null {
  let value = cell.trim();
  if (!value) return null;
  if (delimiter === ';' || delimiter === '\t') {
    const hasDot = value.includes('.');
    const hasComma = value.includes(',');
    if (hasComma && hasDot) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      value = value.replace(',', '.');
    }
  } else {
    value = value.replace(/,/g, '');
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Valida que una URL sea válida (protocolo http/https con host). */
export function isValidHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Determina el tipo de venta (UNIT | WEIGHT) a partir de una celda. */
export function resolveSellBy(cell: string): 'UNIT' | 'WEIGHT' {
  const value = normalizeHeader(cell);
  if (!value) return 'UNIT';
  return value.includes('peso') ||
    value.includes('weight') ||
    value.includes('kg') ||
    value.includes('gramo') ||
    value.includes('gr')
    ? 'WEIGHT'
    : 'UNIT';
}
