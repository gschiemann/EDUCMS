import { proofOfPlayCsv, proofOfPlayCsvFilename } from '../proof-of-play-csv';
import type { ProofOfPlayResponse } from '@/hooks/use-api';

const labels = { type: 'Type', name: 'Name', hours: 'Hours', samples: 'Samples', playlist: 'Playlist', asset: 'Asset', screen: 'Screen' };

const data: ProofOfPlayResponse = {
  ready: true,
  sinceDays: 7,
  sampleMinutes: 10,
  totalSamples: 30,
  estimatedScreenHours: 5,
  playlists: [{ playlistId: 'p1', name: 'Lobby "loop"', samples: 12, estimatedHours: 2 }],
  assets: [{ assetId: 'a1', mimeType: 'image/png', name: '=HYPERLINK("x")', samples: 6, estimatedHours: 1.5 }],
  screens: [{ screenId: 's1', name: 'Café', samples: 18, estimatedHours: 3 }],
};

describe('proofOfPlayCsv', () => {
  const csv = proofOfPlayCsv(data, labels);
  const lines = csv.replace('﻿', '').trim().split('\r\n');

  it('has a header and one row per entry across all three sections', () => {
    expect(lines[0]).toBe('"Type","Name","Hours","Samples"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"Playlist"');
    expect(lines[3]).toContain('"Screen"');
  });
  it('escapes quotes and defuses formula cells', () => {
    expect(lines[1]).toContain('"Lobby ""loop"""');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it('names the file by window and date', () => {
    expect(proofOfPlayCsvFilename(30, new Date('2026-10-11T12:00:00Z'))).toBe('proof-of-play-30d-2026-10-11.csv');
  });
});
