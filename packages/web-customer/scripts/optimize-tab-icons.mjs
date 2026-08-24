import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import { statSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

const jobs = [
  { in: 'Ttodos.png', out: 'todos.webp' },
  { in: 'Rrestaurantes.png', out: 'restaurantes.webp' },
  { in: 'Ttiendas.png', out: 'tiendas.webp' },
];

const SIZE = 1000;

for (const { in: inp, out } of jobs) {
  const src = path.join(PUBLIC, inp);
  const dest = path.join(PUBLIC, out);
  await sharp(src)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85 })
    .toFile(dest);
  const kb = (statSync(dest).size / 1024).toFixed(1);
  console.log(`✔ ${inp} → ${out} (${kb} KB)`);
}

console.log('Optimización de íconos del selector completada.');
