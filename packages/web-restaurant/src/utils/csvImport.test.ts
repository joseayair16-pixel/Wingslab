import {
  parseImportModifiers,
  autoMapImportColumns,
  detectCsvHeaderRow,
  guessCsvDelimiter,
  normalizeHeader,
  parseCsvRows,
  parseImportPrice,
  resolveSellBy,
  isRecognizedSellBy,
} from './csvImport';

describe('modificadores importados', () => {
  it('acepta grupos obligatorios y opcionales con precios', () => {
    const result = parseImportModifiers('Salsa [1-1]: Verde ($0) | Roja ($0); Extras [0-2]: Queso ($15) | Tocino ($20.50)');
    expect(result.errors).toEqual([]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1].options[1].price).toBe(20.5);
  });
  it('detecta tabulaciones aunque haya varios grupos separados por punto y coma', () => {
    const text = 'nombre\tprecio\ttipo\tmodificadores\nPollo\t120\tkg\tSalsa [1-1]: Roja ($0); Extra [0-1]: Queso ($15)';
    const delimiter = guessCsvDelimiter(text);
    const rows = parseCsvRows(text, delimiter);
    const map = autoMapImportColumns(rows[0]);
    expect(delimiter).toBe('\t');
    expect(resolveSellBy(rows[1][map.sellBy!])).toBe('WEIGHT');
    expect(parseImportModifiers(rows[1][map.modifiers!]).groups).toHaveLength(2);
  });
  it('reconoce unidades y evita confundir textos desconocidos con gramos', () => {
    expect(isRecognizedSellBy('por kilogramo')).toBe(true);
    expect(resolveSellBy('por kilogramo')).toBe('WEIGHT');
    expect(isRecognizedSellBy('por pieza')).toBe(true);
    expect(isRecognizedSellBy('grande')).toBe(false);
  });
  it('asigna todas las columnas predeterminadas sin encabezados', () => {
    const map = autoMapImportColumns([]);
    expect([map.category, map.sellBy, map.description, map.discountPrice, map.image]).toEqual([2, 3, 4, 5, 6]);
  });
  it('acepta una celda vacía y rechaza errores sin ignorarlos', () => {
    expect(parseImportModifiers('').groups).toEqual([]);
    expect(parseImportModifiers('Extras [0-2]: Queso ($15)').errors.length).toBeGreaterThan(0);
    expect(parseImportModifiers('Salsa [1-1]: Verde').errors.length).toBeGreaterThan(0);
    expect(parseImportModifiers('Salsa [1-1]: Verde ($0);').errors.length).toBeGreaterThan(0);
  });
});

describe('normalizeHeader', () => {
  it('normaliza mayúsculas y minúsculas', () => {
    expect(normalizeHeader('NOMBRE')).toBe('nombre');
    expect(normalizeHeader('Nombre')).toBe('nombre');
    expect(normalizeHeader('nombre')).toBe('nombre');
  });

  it('elimina acentos', () => {
    expect(normalizeHeader('categoría')).toBe('categoria');
    expect(normalizeHeader('Descripción')).toBe('descripcion');
    expect(normalizeHeader('PRECIO ESPECIAL')).toBe('precio_especial');
  });

  it('normaliza espacios al inicio y final', () => {
    expect(normalizeHeader('  precio  ')).toBe('precio');
  });

  it('colapsa guiones, guiones bajos y espacios múltiples', () => {
    expect(normalizeHeader('precio_producto')).toBe('precio_producto');
    expect(normalizeHeader('precio-producto')).toBe('precio_producto');
    expect(normalizeHeader('precio  del   producto')).toBe('precio_del_producto');
    expect(normalizeHeader('tipo de venta')).toBe('tipo_de_venta');
  });
});

describe('autoMapImportColumns', () => {
  it('mapea encabezados correctos (caso canónico)', () => {
    const map = autoMapImportColumns(['nombre', 'precio', 'categoría', 'tipo', 'descripción']);
    expect(map).toEqual({
      name: 0,
      price: 1,
      category: 2,
      sellBy: 3,
      description: 4,
      discountPrice: undefined,
      image: undefined,
    });
  });

  it('mapea encabezados con mayúsculas', () => {
    const map = autoMapImportColumns(['NOMBRE', 'PRECIO', 'CATEGORÍA']);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
    expect(map.category).toBe(2);
  });

  it('mapea encabezados con acentos', () => {
    const map = autoMapImportColumns(['nombre', 'precio', 'categoría', 'tipo', 'descripción']);
    expect(map.category).toBe(2);
    expect(map.description).toBe(4);
  });

  it('mapea encabezados con espacios y guiones bajos', () => {
    const map = autoMapImportColumns([' nombre ', 'precio_producto', 'categoría del producto']);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
    expect(map.category).toBe(2);
  });

  it('mapea encabezados alternativos', () => {
    const map = autoMapImportColumns(['producto', 'costo', 'unidad de venta', 'detalle', 'precio promocional', 'imagen_url']);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
    expect(map.sellBy).toBe(2);
    expect(map.description).toBe(3);
    expect(map.discountPrice).toBe(4);
    expect(map.image).toBe(5);
  });

  it('usa fallback posicional cuando no hay encabezados reconocibles', () => {
    const map = autoMapImportColumns([]);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
  });

  it('deja sin usar las columnas desconocidas sin romper nada', () => {
    const map = autoMapImportColumns(['nombre', 'precio', 'categoría', 'stock', 'nota interna']);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
    expect(map.category).toBe(2);
    expect(map.sellBy).toBeUndefined();
    expect(map.discountPrice).toBeUndefined();
    expect(map.image).toBeUndefined();
  });

  it('no asigna dos campos a la misma columna', () => {
    const map = autoMapImportColumns(['nombre', 'precio', 'categoría']);
    const values = Object.values(map).filter((v): v is number => v !== undefined);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('detectCsvHeaderRow', () => {
  it('detecta una fila de encabezados', () => {
    expect(detectCsvHeaderRow(['nombre', 'precio', 'categoría'])).toBe(true);
    expect(detectCsvHeaderRow(['Nombre', 'Precio'])).toBe(true);
  });

  it('no marca una fila de datos como encabezado', () => {
    expect(detectCsvHeaderRow(['Tacos al pastor', '45', 'Tacos'])).toBe(false);
  });
});

describe('guessCsvDelimiter', () => {
  it('detecta coma', () => {
    expect(guessCsvDelimiter('a,b,c\nd,e,f')).toBe(',');
  });

  it('detecta punto y coma', () => {
    expect(guessCsvDelimiter('a;b;c\nd;e;f')).toBe(';');
  });

  it('detecta tabulación', () => {
    expect(guessCsvDelimiter('a\tb\tc\nd\te\tf')).toBe('\t');
  });
});

describe('parseCsvRows', () => {
  it('parsea filas con separador por coma', () => {
    const rows = parseCsvRows('nombre,precio\ntacos,45\nburger,89', ',');
    expect(rows).toEqual([
      ['nombre', 'precio'],
      ['tacos', '45'],
      ['burger', '89'],
    ]);
  });

  it('parsea filas con separador por punto y coma', () => {
    const rows = parseCsvRows('nombre;precio\ntacos;45', ';');
    expect(rows).toEqual([
      ['nombre', 'precio'],
      ['tacos', '45'],
    ]);
  });

  it('parsea filas separadas por tabulación', () => {
    const rows = parseCsvRows('nombre\tprecio\ntacos\t45', '\t');
    expect(rows).toEqual([
      ['nombre', 'precio'],
      ['tacos', '45'],
    ]);
  });

  it('respeta comillas dobles y comillas escapadas', () => {
    const rows = parseCsvRows('nombre,descripcion\n"Burger House","Carne con ""queso"""', ',');
    expect(rows[1]).toEqual(['Burger House', 'Carne con "queso"']);
  });

  it('descarta filas vacías', () => {
    const rows = parseCsvRows('a,b\n\nc,d\n\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parsea datos pegados desde Excel/Sheets (con CRLF y comillas)', () => {
    const rows = parseCsvRows('"nombre","precio"\r\n"tacos",45\r\n"burger",89\r\n', ',');
    expect(rows).toEqual([
      ['nombre', 'precio'],
      ['tacos', '45'],
      ['burger', '89'],
    ]);
  });
});

describe('parseImportPrice', () => {
  it('parsea precio entero', () => {
    expect(parseImportPrice('89', ',')).toBe(89);
  });

  it('parsea precio con decimales con coma como separador', () => {
    expect(parseImportPrice('89.50', ',')).toBe(89.5);
  });

  it('parsea precio con coma decimal cuando el delimitador es punto y coma', () => {
    expect(parseImportPrice('89,50', ';')).toBe(89.5);
  });

  it('parsea precio con separador de miles con coma', () => {
    expect(parseImportPrice('1,000', ',')).toBe(1000);
  });

  it('devuelve null para precio vacío', () => {
    expect(parseImportPrice('', ',')).toBeNull();
  });

  it('devuelve null para precio no numérico', () => {
    expect(parseImportPrice('abc', ',')).toBeNull();
  });
});

describe('resolveSellBy', () => {
  it('resuelve UNIT para pieza/unidad', () => {
    expect(resolveSellBy('pieza')).toBe('UNIT');
    expect(resolveSellBy('unidad')).toBe('UNIT');
    expect(resolveSellBy('')).toBe('UNIT');
  });

  it('resuelve WEIGHT para peso/kg/gramos', () => {
    expect(resolveSellBy('peso')).toBe('WEIGHT');
    expect(resolveSellBy('kg')).toBe('WEIGHT');
    expect(resolveSellBy('kilogramos')).toBe('WEIGHT');
  });
});

describe('flujo completo del caso del usuario', () => {
  const csv = [
    'nombre,precio,categoría,tipo,descripción',
    'Burger House Clásica,89,Hamburguesas,pieza,Carne de res con queso',
    'Cheese Burger,99,Hamburguesas,pieza,Hamburguesa con doble queso',
    'BBQ Burger,119,Hamburguesas,pieza,Carne con queso tocino y salsa BBQ',
  ].join('\n');

  it('mapea todas las columnas y produce 0 errores', () => {
    const delimiter = guessCsvDelimiter(csv);
    const rows = parseCsvRows(csv, delimiter);
    const header = rows[0];
    const data = rows.slice(1);

    expect(detectCsvHeaderRow(header)).toBe(true);
    const map = autoMapImportColumns(header);
    expect(map).toEqual({
      name: 0,
      price: 1,
      category: 2,
      sellBy: 3,
      description: 4,
      discountPrice: undefined,
      image: undefined,
    });

    const valid = data.filter((row) => {
      const cell = (idx: number | undefined) => (idx !== undefined ? (row[idx] ?? '').trim() : '');
      const name = cell(map.name);
      const price = parseImportPrice(cell(map.price), delimiter);
      const category = cell(map.category);
      const description = cell(map.description) || name;
      if (!name || name.length < 2) return false;
      if (price === null || price <= 0) return false;
      if (!category) return false;
      if (description && description.trim().length < 5) return false;
      return true;
    });

    expect(valid.length).toBe(3);
  });
});

describe('validez del importador con categorías nuevas (regresión del bug)', () => {
  // Simula la lógica de isValid del componente page.tsx: una fila es válida
  // si no hay errores y la categoría está resuelta (existente O a crear).
  function buildRowsValid(input: string, createMissing: boolean): number {
    const delimiter = guessCsvDelimiter(input);
    const rows = parseCsvRows(input, delimiter);
    const header = rows[0];
    const data = rows.slice(1);
    const map = autoMapImportColumns(header);

    return data.filter((row) => {
      const cell = (idx: number | undefined) => (idx !== undefined ? (row[idx] ?? '').trim() : '');
      const errors: string[] = [];
      const name = cell(map.name);
      const price = parseImportPrice(cell(map.price), delimiter);
      const categoryName = cell(map.category);
      if (!name || name.length < 2) errors.push('name');
      if (price === null || price <= 0) errors.push('price');

      let categoryTargetId = '';
      let willCreateCategory = false;
      if (categoryName) {
        if (createMissing) willCreateCategory = true;
        else errors.push('categoria no existe');
      } else {
        errors.push('sin categoria');
      }

      const isValid = errors.length === 0 && (Boolean(categoryTargetId) || willCreateCategory);
      return isValid;
    }).length;
  }

  const csv = [
    'nombre,precio,categoría,tipo,descripción',
    'Burger House Clásica,89,Hamburguesas,pieza,Carne de res con queso',
    'Cheese Burger,99,Hamburguesas,pieza,Hamburguesa con doble queso',
    'BBQ Burger,119,Hamburguesas,pieza,Carne con queso tocino y salsa BBQ',
  ].join('\n');

  it('marca como válidas las filas con categorías nuevas cuando crear faltantes está activo', () => {
    expect(buildRowsValid(csv, true)).toBe(3);
  });

  it('marca como inválidas las filas con categorías nuevas si crear faltantes está desactivado', () => {
    expect(buildRowsValid(csv, false)).toBe(0);
  });

  it('mapea correctamente los encabezados del ejemplo de 20 productos', () => {
    const header = ['nombre', 'precio', 'categoría', 'tipo', 'descripción'];
    const map = autoMapImportColumns(header);
    expect(map.name).toBe(0);
    expect(map.price).toBe(1);
    expect(map.category).toBe(2);
    expect(map.sellBy).toBe(3);
    expect(map.description).toBe(4);
    expect(map).toMatchObject({ discountPrice: undefined, image: undefined });
  });
});
