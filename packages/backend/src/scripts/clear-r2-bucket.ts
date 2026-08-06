import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.error('Faltan variables R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).');
    process.exit(1);
  }

  if (!process.argv.includes('--confirm')) {
    console.error('Seguridad: agrega --confirm para eliminar todos los objetos del bucket.');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  let total = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    const keys = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k);

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
      total += keys.length;
      console.log(`Eliminados ${total} objetos...`);
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  console.log(`Bucket R2 limpio: ${total} objetos eliminados.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error limpiando R2:', err);
    process.exit(1);
  });
