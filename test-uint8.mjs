import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

async function run() {
  const BUCKET = 'assets';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) { throw new Error('Missing env vars'); }

  const buffer = Buffer.alloc(1024 * 1024, 'a');
  const filePath = 'test-tenant/test-uint8.jpg';
  const contentType = 'image/jpeg';
  
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
  
  const payload = new Uint8Array(buffer);

  // POST directly to the Storage REST API
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: payload, // Passed as Uint8Array
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage upload failed (${res.status}): ${body}`);
  }
  
  // Now download it to see the actual size
  const getRes = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${filePath}`);
  const ab = await getRes.arrayBuffer();
  console.log('Downloaded Uint8Array size:', ab.byteLength);
}

run().catch(console.error);
