/**
 * MusicService — backs the MusicPlayerWidget config UI.
 *
 * Created 2026-05-25 (music-overhaul). Operator question that drove
 * this:
 *   "how do I use the music plugin that we have on this template,
 *   can I plug me apple music or spotify for business info in somehow
 *   or can we feed free music somehow maybe even based on the sites
 *   location info we feed local free music/radio?"
 *
 * What this service does today (no commercial agreements required):
 *   - Returns a curated SomaFM station list for the Properties dropdown.
 *   - Discovers NPR member stations near a lat/lng using NPR's
 *     publicly-listed station catalog. (Station finder API behind
 *     auth; we ship a static catalog of the top US stations so the
 *     feature works without an NPR API key. When/if NPR opens an
 *     anonymous endpoint we swap in the live call.)
 *
 * What it does NOT do today:
 *   - Apple Music / Spotify for Business OAuth. The widget surfaces
 *     "Coming soon — Notify me" with a mailto:sales link; the
 *     controller endpoints return 503 until env vars are configured.
 */
import { Injectable } from '@nestjs/common';

export interface SomafmStation {
  id: string;
  name: string;
  description: string;
  genre: string;
}

const SOMAFM_STATIONS: ReadonlyArray<SomafmStation> = [
  { id: 'groovesalad',  name: 'Groove Salad',         description: 'Chilled, ambient, mid-tempo electronica.', genre: 'electronic' },
  { id: 'dronezone',    name: 'Drone Zone',           description: 'Atmospheric textures with minimal beats.', genre: 'ambient' },
  { id: 'secretagent',  name: 'Secret Agent',         description: 'Spy and crime-jazz soundtrack vibe.', genre: 'jazz-noir' },
  { id: 'lush',         name: 'Lush',                  description: 'Sensuous, female-vocal electronic.', genre: 'electronic' },
  { id: 'bagel',        name: 'BAGeL Radio',          description: 'Indie rock — alt to alt-pop.', genre: 'indie' },
  { id: 'defcon',       name: 'DEF CON Radio',        description: 'Music for hackers.', genre: 'electronic' },
  { id: 'spacestation', name: 'Space Station Soma',   description: 'Tribal beats + downtempo + ambient electronica.', genre: 'electronic' },
  { id: 'beatblender',  name: 'Beat Blender',          description: 'Late-night downtempo blends.', genre: 'electronic' },
  { id: 'indie',        name: 'Indie Pop Rocks!',     description: 'Bright indie pop, rock, and twee.', genre: 'indie' },
  { id: 'cliqhop',      name: 'cliqhop idm',           description: 'Intelligent dance music + glitchy IDM.', genre: 'electronic' },
  { id: 'poptron',      name: 'PopTron',               description: 'Electropop and indie-dance.', genre: 'pop' },
  { id: 'thetrip',      name: 'The Trip',              description: 'Progressive house / trance.', genre: 'electronic' },
  { id: 'fluid',        name: 'Fluid',                 description: 'Liquid drum & bass + hip hop.', genre: 'hiphop' },
  { id: 'folkfwd',      name: 'Folk Forward',          description: 'Indie folk + Americana.', genre: 'folk' },
  { id: 'illstreet',    name: 'Illinois Street Lounge', description: 'Mid-century bachelor-pad cocktail jazz.', genre: 'jazz' },
  { id: 'brfm',         name: 'Black Rock FM',         description: 'Burning Man Black Rock City mix.', genre: 'eclectic' },
  { id: 'digitalis',    name: 'Digitalis',             description: 'Digital folk / lo-fi indie / electroacoustica.', genre: 'electronic' },
  { id: 'metal',        name: 'Metal Detector',        description: 'Stoner / doom / sludge / psychedelic metal.', genre: 'metal' },
  { id: '7soul',        name: 'Seven Inch Soul',       description: 'Vintage soul on 45 rpm vinyl.', genre: 'soul' },
  { id: 'seventies',    name: 'Left Coast 70s',        description: '70s singer-songwriter California rock.', genre: 'rock' },
  { id: 'u80s',         name: 'Underground 80s',       description: 'Early 80s industrial, gothic, post-punk.', genre: 'rock' },
];

// Curated catalog of the largest U.S. NPR member stations with
// publicly-listed lat/lng + stream URLs. Avoids needing an NPR API
// key for the v1 station-finder. Lat/lng are the transmitter or
// station-HQ city centers; close enough for "is there an NPR near
// me?" UX. Stream URLs are the stations' own public Icecast / HLS
// endpoints (each station hosts these themselves — we never proxy).
interface NprStation {
  callSign: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  streamUrl: string;
}

const NPR_STATIONS: ReadonlyArray<NprStation> = [
  { callSign: 'WNYC',    name: 'WNYC',                       city: 'New York',      state: 'NY', latitude: 40.7128, longitude: -74.0060, streamUrl: 'https://fm939.wnyc.org/wnycfm' },
  { callSign: 'WBEZ',    name: 'WBEZ Chicago',               city: 'Chicago',       state: 'IL', latitude: 41.8781, longitude: -87.6298, streamUrl: 'https://stream.wbez.org/wbez128' },
  { callSign: 'KQED',    name: 'KQED-FM',                    city: 'San Francisco', state: 'CA', latitude: 37.7749, longitude: -122.4194, streamUrl: 'https://streams.kqed.org/kqedradio' },
  { callSign: 'WAMU',    name: 'WAMU 88.5',                  city: 'Washington',    state: 'DC', latitude: 38.9072, longitude: -77.0369, streamUrl: 'https://wamu-1.streamguys1.com/wamu-128k' },
  { callSign: 'WBUR',    name: 'WBUR',                       city: 'Boston',        state: 'MA', latitude: 42.3601, longitude: -71.0589, streamUrl: 'https://wbur-news.streamguys1.com/wbur' },
  { callSign: 'KCRW',    name: 'KCRW',                       city: 'Santa Monica',  state: 'CA', latitude: 34.0195, longitude: -118.4912, streamUrl: 'https://kcrw.streamguys1.com/kcrw_192k_mp3_e24' },
  { callSign: 'KPCC',    name: 'LAist (KPCC)',               city: 'Pasadena',      state: 'CA', latitude: 34.1478, longitude: -118.1445, streamUrl: 'https://live.scpr.org/kpcclive' },
  { callSign: 'WHYY',    name: 'WHYY',                       city: 'Philadelphia',  state: 'PA', latitude: 39.9526, longitude: -75.1652, streamUrl: 'https://whyy.streamguys1.com/whyy.aac' },
  { callSign: 'WGBH',    name: 'WGBH',                       city: 'Boston',        state: 'MA', latitude: 42.3601, longitude: -71.0589, streamUrl: 'https://audio.wgbh.org/wgbh-news.mp3' },
  { callSign: 'WBEZ-2',  name: 'WBEZ Vocalo',                city: 'Chicago',       state: 'IL', latitude: 41.8781, longitude: -87.6298, streamUrl: 'https://stream.vocalo.org/vocalo128' },
  { callSign: 'KEXP',    name: 'KEXP',                       city: 'Seattle',       state: 'WA', latitude: 47.6062, longitude: -122.3321, streamUrl: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3' },
  { callSign: 'KOPB',    name: 'OPB',                        city: 'Portland',      state: 'OR', latitude: 45.5152, longitude: -122.6784, streamUrl: 'https://opb-aac.streamguys1.com/opb128' },
  { callSign: 'KUOW',    name: 'KUOW',                       city: 'Seattle',       state: 'WA', latitude: 47.6062, longitude: -122.3321, streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUOWFM.mp3' },
  { callSign: 'KERA',    name: 'KERA',                       city: 'Dallas',        state: 'TX', latitude: 32.7767, longitude: -96.7970, streamUrl: 'https://kera-ice.streamguys1.com/kera-news' },
  { callSign: 'KUT',     name: 'KUT',                        city: 'Austin',        state: 'TX', latitude: 30.2672, longitude: -97.7431, streamUrl: 'https://kut.streamguys1.com/kut-web' },
  { callSign: 'KUHF',    name: 'Houston Public Media',       city: 'Houston',       state: 'TX', latitude: 29.7604, longitude: -95.3698, streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUHFFM.mp3' },
  { callSign: 'WUWM',    name: 'WUWM',                       city: 'Milwaukee',     state: 'WI', latitude: 43.0389, longitude: -87.9065, streamUrl: 'https://wuwm-ice.streamguys1.com/wuwm-mp3' },
  { callSign: 'WKAR',    name: 'WKAR',                       city: 'East Lansing',  state: 'MI', latitude: 42.7370, longitude: -84.4839, streamUrl: 'https://wkar-mp3.streamguys1.com/wkarfm.mp3' },
  { callSign: 'MPR',     name: 'Minnesota Public Radio',     city: 'Saint Paul',    state: 'MN', latitude: 44.9537, longitude: -93.0900, streamUrl: 'https://nis.stream.publicradio.org/nis.aac' },
  { callSign: 'KCFR',    name: 'CPR News (Denver)',          city: 'Denver',        state: 'CO', latitude: 39.7392, longitude: -104.9903, streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KCFRFMAAC.aac' },
  { callSign: 'WFAE',    name: 'WFAE',                       city: 'Charlotte',     state: 'NC', latitude: 35.2271, longitude: -80.8431, streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/WFAEFM.mp3' },
  { callSign: 'WUNC',    name: 'WUNC',                       city: 'Chapel Hill',   state: 'NC', latitude: 35.9132, longitude: -79.0558, streamUrl: 'https://amb01.streamguys1.com/wunc-mp3' },
];

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

@Injectable()
export class MusicService {
  listSomafmStations() {
    return SOMAFM_STATIONS;
  }

  findNprStations(opts: { latitude: number; longitude: number; radiusKm: number }) {
    const { latitude, longitude, radiusKm } = opts;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { stations: [], note: 'No location supplied — pass latitude + longitude.' };
    }
    const ranked = NPR_STATIONS.map((s) => ({
      ...s,
      distanceKm: Math.round(haversineKm({ latitude, longitude }, s) * 10) / 10,
    }))
      .filter((s) => s.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
    return {
      stations: ranked,
      note: ranked.length === 0
        ? 'No catalog stations within radius. Try expanding the radius or paste an NPR member station stream URL into the Custom Stream field.'
        : undefined,
    };
  }
}
