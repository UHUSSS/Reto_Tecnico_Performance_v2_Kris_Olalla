/**
 * Prueba de carga - Servicio de Login (fakestoreapi.com)
 *
 * Objetivo: validar que el endpoint POST /auth/login soporte al menos
 * 20 TPS cumpliendo:
 *   - Tiempo de respuesta (p95) <= 1.5s
 *   - Tasa de error < 3%
 *
 * Ejecucion:
 *   k6 run scripts/login-load-test.js
 *
 * Variables de entorno opcionales:
 *   BASE_URL   (default: https://fakestoreapi.com)
 *   TARGET_TPS (default: 25)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const BASE_URL = __ENV.BASE_URL || 'https://fakestoreapi.com';
const TARGET_TPS = Number(__ENV.TARGET_TPS || 25); // por encima del SLA (20 TPS) para dejar margen

// Carga el CSV una sola vez y lo comparte entre todas las VUs (evita duplicar memoria)
const users = new SharedArray('usuarios', function () {
  const csv = open('../data/usuarios.csv');
  return papaparse.parse(csv, { header: true, skipEmptyLines: true }).data;
});

export const options = {
  scenarios: {
    login_load: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 60,
      maxVUs: 200,
      stages: [
        { target: Math.round(TARGET_TPS * 0.4), duration: '30s' }, // calentamiento
        { target: TARGET_TPS, duration: '30s' },                   // rampa de subida hasta el objetivo (>=20 TPS)
        { target: TARGET_TPS, duration: '2m' },                    // estado estable: sostiene el TPS objetivo
        { target: 0, duration: '30s' },                            // rampa de bajada
      ],
    },
  },
  thresholds: {
    // SLA: tiempo de respuesta maximo 1.5s. Se valida con p(95) por ser el
    // indicador estandar de la industria, robusto frente a outliers puntuales;
    // el maximo absoluto se reporta y discute en conclusiones.md
    http_req_duration: ['p(95)<1500'],
    // SLA: tasa de error < 3%
    http_req_failed: ['rate<0.03'],
    checks: ['rate>0.97'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  const row = users[(__VU + __ITER) % users.length];

  const payload = JSON.stringify({
    username: row.user,
    password: row.passwd,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '60s',
    tags: { name: 'POST /auth/login' },
  };

  const res = http.post(`${BASE_URL}/auth/login`, payload, params);

  check(res, {
    // fakestoreapi.com responde 201 (Created) en login exitoso, no 200
    'status es 2xx (200/201)': (r) => r.status === 200 || r.status === 201,
    'respuesta contiene token': (r) => {
      try {
        return !!JSON.parse(r.body).token;
      } catch (e) {
        return false;
      }
    },
    'tiempo de respuesta < 1.5s': (r) => r.timings.duration < 1500,
  });

  sleep(0.1);
}

// Genera stdout legible + guarda JSON y texto plano para el repositorio
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reportes/summary.json': JSON.stringify(data, null, 2),
    'reportes/textSummary.txt': textSummary(data, { indent: ' ', enableColors: false }),
  };
}
