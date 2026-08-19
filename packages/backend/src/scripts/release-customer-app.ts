/**
 * Sube el APK del comensal a R2 (versionado + alias `latest`) y publica la
 * version en SystemSetting para que `GET /app/version` la sirva.
 *
 * Uso (con variables R2 y DATABASE_URL disponibles, p.ej. via `railway run`):
 *   npx tsx src/scripts/release-customer-app.ts \
 *     --apk /ruta/al/sadel-customer-release.apk \
 *     --version-name 1.0 \
 *     --version-code 1 \
 *     --changelog "Primera version publica." \
 *     --required false
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { statSync } from 'node:fs';

import { prisma } from '../config/database';

type Args = {
  apkPath: string;
  versionName: string;
  versionCode: number;
  changelog: string;
  required: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const apkPath = get('--apk') || 'dist/sadel-customer-release.apk';
  const versionName = get('--version-name') || '';
  const versionCode = Number(get('--version-code') || '');
  const changelog = get('--changelog') || '';
  const required = get('--required') === 'true';

  if (!apkPath || !versionName || !Number.isInteger(versionCode) || versionCode <= 0) {
    console.error('Uso: --apk <ruta> --version-name <v> --version-code <n> [--changelog <txt>] [--required true|false]');
    process.exit(1);
  }

  return { apkPath, versionName, versionCode, changelog, required };
}

async function main() {
  const { apkPath, versionName, versionCode, changelog, required } = parseArgs();

  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const publicUrl = process.env.R2_PUBLIC_URL?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.error('Faltan variables R2. Corre con `railway run` para inyectarlas.');
    process.exit(1);
  }

  const sizeBytes = statSync(apkPath).size;
  const safeVersion = versionName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const versionedKey = `apps/comensal/sadel-comensal-${safeVersion}.apk`;
  const latestKey = 'apps/comensal/latest.apk';

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const upload = async (key: string) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: createReadStream(apkPath),
        ContentType: 'application/vnd.android.package-archive',
        ContentDisposition: `attachment; filename="sadel-comensal-${safeVersion}.apk"`,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: {
          'sadel-version-name': versionName,
          'sadel-version-code': String(versionCode),
          'sadel-size-bytes': String(sizeBytes),
        },
      })
    );
  };

  console.log(`Subiendo ${apkPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)...`);
  await upload(versionedKey);
  console.log(`  OK ${versionedKey}`);
  await upload(latestKey);
  console.log(`  OK ${latestKey}`);

  const url = publicUrl
    ? `${publicUrl.replace(/\/+$/, '')}/${versionedKey}`
    : `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${versionedKey}`;

  const payload = {
    platform: 'android',
    versionName,
    versionCode,
    url,
    fileName: `sadel-comensal-${safeVersion}.apk`,
    sizeBytes,
    changelog,
    required,
    publishedAt: new Date().toISOString(),
  };

  const saved = await prisma.systemSetting.upsert({
    where: { key: 'comensalAppVersion' },
    update: { value: JSON.stringify(payload) },
    create: { key: 'comensalAppVersion', value: JSON.stringify(payload) },
  });

  console.log(`Version publicada (SystemSetting #${saved.id}):`);
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());