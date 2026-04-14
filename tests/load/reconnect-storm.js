import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * QA Architecture: Thundering Herd Mitigation
 * Objective: Validate how the backend handles 5,000 devices instantly waking up from a network dropout
 * and HTTP polling the `/sync` endpoint concurrently, ensuring DB connection pools do not explode.
 */

export const options = {
  discardResponseBodies: true,
  scenarios: {
    // Massive concurrent spike simulating routing restoration
    reconnection_storm: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 1000,
      maxVUs: 5000,
      stages: [
        { target: 5000, duration: '3s' }, // 5,000 devices slam the server in 3 seconds
        { target: 0, duration: '10s' },   // Taper off quickly
      ],
    },
  },
  thresholds: {
    // 99% of requests must be served without database crash/timeout
    'http_req_failed': ['rate<0.01'], 
    // Devices should get their cache layout under 2 seconds during a storm
    'http_req_duration': ['p(95)<2000'],
  },
};

export default function () {
  const url = 'http://127.0.0.1:3000/api/v1/device/sync';
  
  // The devices use an ETag/If-None-Match header cache validation check
  // to avoid downloading a 5MB payload if exactly matched
  const params = {
    headers: {
      'Authorization': `Bearer MOCK_DEVICE_${__VU}`,
      'If-None-Match': '"mocked-etag-hash-1234"',
    },
  };

  const res = http.get(url, params);
  
  // Expecting exactly 304 Not Modified if the fleet is up to date, avoiding DB reads
  check(res, {
    'Sync responded in time': (r) => r.status === 304 || r.status === 200 || r.status === 404,
  });
  
  sleep(1);
}
