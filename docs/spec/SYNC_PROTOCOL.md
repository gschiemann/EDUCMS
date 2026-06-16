# Sync Protocol (Incremental Manifest Polling)

## Overview
This document outlines the strict protocol governing how the Android Player synchronizes state, playlists, and assets with the Backend, optimized for extremely hostile and unreliable network conditions common in school districts.

## Guiding Safety Principles
1. **Never Clear Unverified Cache**: The Android device must never prune its currently functional assets until the newly requested manifest is fully downloaded, its linked assets downloaded, and hashes cryptographically verified.
2. **Deterministic Hashing**: All media assets must be verified using SHA-256 to prevent silent screen corruption.
3. **Stateless Differential Sync**: The Android device is responsible for providing its current `versionHash` directly; the backend does not hold the device's state, preventing backend/frontend race conditions.

## The Android Sync Loop Protocol
1. **Heartbeat & Request**: Every 5 minutes (plus arbitrary jitter to prevent thundering herd), the device polls `GET /api/v1/devices/{deviceId}/manifest?version={localVersionHash}`.
   - If the version hasn't changed, Backend responds tightly with `304 Not Modified`.
2. **Download Manifest**: If an administration change was made, Backend returns a `200 OK` with a full structured JSON manifest and a new `versionHash`.
3. **Asset Delta Check & Transfer Phase**:
   - Device parses the returned Manifest using the Zod core validation layer.
   - It diffs the `assets` payload with its local SQLite persistent store.
   - Missing assets are pulled via the provided pre-signed S3 URLs.
   - All newly downloaded assets are locally hashed. **If a single hash fails**, the update sequence aborts. A metric is fired via telemetry, and playback of old cached content continues indefinitely.
4. **Final Commit Phase**: If all schema and asset verifications pass, the SQLite store commits the new `versionHash` and active schedule. Orphaned assets no longer referenced in the current manifest are successfully safely expunged from local storage to prevent OOM errors.
