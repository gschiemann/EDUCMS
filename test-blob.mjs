import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

async function run() {
  const BUCKET = 'assets';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) { throw new Error('Missing env vars'); }

  const buffer = Buffer.alloc(1024 * 1024, 'a');
  const filePath = 'test-tenant/test-blob.jpg';
  const contentType = 'image/jpeg';
  
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
  
  // Wrap Buffer in Blob to ensure undici treats it as binary
  const blob = new Blob([buffer], { type: contentType });

  console.log('Endpoint:', endpoint);

  // POST directly to the Storage REST API
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: blob, // Passed as Blob
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage upload failed (${res.status}): ${body}`);
  }

  console.log('Uploaded successfully! Checking the file length...');
  
  // Now download it to see the actual size
  const getRes = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${filePath}`);
  const ab = await getRes.arrayBuffer();
  console.log('Downloaded size:', ab.byteLength);
}

run().catch(console.error);
