import { Request, Response } from 'express';
import crypto from 'crypto';

// In production, this imports S3Client from aws-sdk v3.
// Mocking the interface for the architecture implementation.
const MOCK_BUCKET_NAME = process.env.S3_BUCKET || 'edu-cms-assets-prod';

export const generateAssetUploadSignature = async (req: Request, res: Response) => {
  const user = res.locals.user;
  if (!user || (!user.districtId && !user.schoolId)) {
    return res.status(403).json({ error: 'Tenant context required for asset upload' });
  }

  const { filename, contentType } = req.body;
  if (!filename || !contentType) {
    return res.status(400).json({ error: 'Filename and contentType are required' });
  }

  // Security Gate: Directory Traversal Prevention
  // Scrub the filename to remove any path attempts (e.g. `../../../malicious`)
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

  // Security Gate: Path isolation. Assets are strictly partitioned by tenant ID in S3
  const tenantPrefix = user.districtId ? `districts/${user.districtId}` : `schools/${user.schoolId}`;
  const fileKey = `${tenantPrefix}/quarantine/${crypto.randomUUID()}-${safeFilename}`;

  // Security Gate: Generate Signed URL for direct-to-S3 upload (bypasses node bottleneck, preserves isolation)
  // Mocking the getSignedUrl behavior 
  const signedUploadUrl = `https://${MOCK_BUCKET_NAME}.s3.amazonaws.com/${fileKey}?X-Amz-Signature=mock&Expires=3600`;

  // Note on Malware Scanning:
  // The file is uploaded to the /quarantine/ prefix.
  // An AWS CloudTrail/EventBridge trigger will fire an anti-virus Lambda (ClamAV).
  // If clean, the Lambda moves the file to /active/ and updates the database 'status' to READY.

  res.json({
    uploadUrl: signedUploadUrl,
    fileKey: fileKey,
    status: 'PENDING_SCAN' // Explicit state indicating it cannot be scheduled yet
  });
};

export const getSignedReadUrl = async (req: Request, res: Response) => {
  const { assetId } = req.params;
  const user = res.locals.user;

  // DB Mock: verifying the user owns the asset before signing the URL (BOLA prevention)
  // const asset = await db.query('SELECT * FROM assets WHERE id = $1 AND school_id = $2', [assetId, user.schoolId])
  const fileKey = `schools/${user.schoolId}/active/mock-asset.jpg`;

  // Provide a short-lived (60 minute) read-only distribution URL
  const signedReadUrl = `https://${MOCK_BUCKET_NAME}.s3.amazonaws.com/${fileKey}?X-Amz-Signature=mockREAD&Expires=3600`;
  
  res.json({ signedUrl: signedReadUrl });
};
