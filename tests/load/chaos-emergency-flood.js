import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 Chaos Testing Script
// Objective: Flood the trigger endpoint to attempt to bypass RBAC Race Conditions 
// and evaluate Throttler limits.

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp up to 50 concurrent bad actors
    { duration: '1m', target: 500 }, // Flood with 500 virtual users trying to lockdown
  ],
};

const BASE_URL = 'http://localhost:3000/api/v1/emergency';

export default function () {
  const stolenJWT = 'eyJhbGciOiJIUzI1NiIsIn...'; // Simulated token
  
  const payload = JSON.stringify({
    scopeType: 'tenant',
    scopeId: 'school-1234',
    overridePayload: { severity: 'CRITICAL' }
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${stolenJWT}`,
    },
  };

  const res = http.post(`${BASE_URL}/trigger`, payload, params);

  // Assertions ensuring the system defends itself
  check(res, {
    'Is Unauthorized OR Rate Limited': (r) => r.status === 401 || r.status === 429,
    'Not 200 OK (Exploit failed)': (r) => r.status !== 200,
  });

  sleep(0.1);
}
