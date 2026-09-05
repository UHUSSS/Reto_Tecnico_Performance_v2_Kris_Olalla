# Conclusiones – Ejercicio 1 (Prueba de carga del servicio de login)

**Endpoint bajo prueba:** `POST https://fakestoreapi.com/auth/login`
**Herramienta:** k6 v2.2.0 · **Ejecutor:** `ramping-arrival-rate` (25 iter/s objetivo, 2 min de plateau)
**Evidencia:** [`ejercicio1-k6/reportes/textSummary.txt`](./ejercicio1-k6/reportes/textSummary.txt), [`summary.json`](./ejercicio1-k6/reportes/summary.json), [`vus_vs_tps.png`](./ejercicio1-k6/reportes/vus_vs_tps.png), [`dashboard-report.html`](./ejercicio1-k6/reportes/dashboard-report.html) (dashboard nativo de k6, ábrelo en el navegador)

## 1. Resumen ejecutivo

La prueba **cumple los tres criterios del SLA** definidos en el reto (≥20 TPS, tasa de error <3%, tiempo de respuesta con p(95) < 1.5s), siempre que el TPS se mida sobre la **ventana de estado estable (plateau)** y no sobre el promedio de toda la ejecución. Esta distinción es en sí misma uno de los hallazgos más relevantes del ejercicio (ver sección 3).

## 2. Resultados obtenidos

| Métrica | Resultado | Criterio SLA | Cumple |
|---|---|---|---|
| Throughput en plateau (estado estable) | **~25.0 TPS** (2,750 req en 110s) | ≥ 20 TPS | ✅ |
| Throughput promedio de toda la corrida | 19.64–19.79 TPS (incluye rampa) | — (ver nota) | ⚠️ ver sección 3 |
| Tasa de error (`http_req_failed`) | **0.00 %** (0 de 4,124 peticiones) | < 3 % | ✅ |
| Tiempo de respuesta p(95) | **552 ms** | ≤ 1.5 s | ✅ |
| Tiempo de respuesta p(99) | 659 ms | — | ✅ |
| Tiempo de respuesta máximo absoluto | 1.11 s | ≤ 1.5 s (interpretación estricta) | ✅ |
| Checks (status 2xx + token + latencia) | 100 % (12,372/12,372) | — | ✅ |
| VUs necesarios en plateau | 11–14 (pico puntual de 16 según k6) | — | — |

Total: 4,124 peticiones en ~208s de ejecución real (incluye warm-up, ramp-up, plateau y ramp-down).

## 3. Hallazgo clave: promedio de toda la corrida vs. TPS en estado estable

El resumen final de k6 reporta `http_reqs: 4124  19.638053/s`, es decir, un promedio **ligeramente por debajo** del umbral de 20 TPS. Sin embargo, ese número se calcula dividiendo el total de peticiones entre la **duración completa del test**, la cual incluye 30s de warm-up (arrancando en 0 TPS) y 30s de ramp-down (terminando en 0 TPS) — períodos que, por diseño, no representan la capacidad sostenida del servicio, sino la transición hacia/desde ella.

Al segmentar la serie temporal en ventanas de 5s (ver `vus_vs_tps.csv` y el gráfico `vus_vs_tps.png`) se observa:

- **t=0–50s (warm-up/ramp-up):** el TPS crece de ~3 a ~20 req/s de forma lineal, siguiendo la rampa configurada.
- **t=60–180s (plateau):** el TPS se estabiliza en **~25 req/s** de forma consistente (rango 24.7–25.2 req/s), superando el SLA con margen.
- **t=180–208s (ramp-down):** el TPS decae de ~25 a 0 req/s.

**Conclusión:** el servicio sí sostiene ≥20 TPS de forma consistente; el promedio global reportado por defecto en el resumen de k6 es una métrica agregada que subestima la capacidad real cuando el escenario incluye rampas. Esta es la misma razón por la que, en el Ejercicio 2, se debe leer con cautela cualquier cifra de "TPS promedio" sin contrastarla contra el gráfico de VUs vs. `http_reqs` a lo largo del tiempo.

**Recomendación práctica:** para gating en CI/CD, definir el threshold de throughput sobre una ventana de estado estable explícita (excluyendo los primeros/últimos N segundos), o reportar siempre el TPS de plateau junto al promedio total para evitar falsos negativos de SLA.

## 4. Relación VUs vs. throughput (Little's Law)

Durante el plateau, k6 necesitó entre 11 y 14 VUs concurrentes (con un pico puntual de 16) para sostener ~25 TPS. Esto es consistente con la Ley de Little (`VUs ≈ TPS × tiempo_de_respuesta_promedio`): `25 TPS × ~0.44s ≈ 11 VUs`, muy cercano a lo observado. La baja latencia del endpoint (avg 444ms) es lo que permite alcanzar el TPS objetivo con relativamente pocos usuarios virtuales — un indicador de que el servicio (al menos en este rango de carga) no está saturado y tiene margen para escalar el throughput objetivo en pruebas futuras.

## 5. Otros hallazgos

- **Corrección de status esperado:** el enunciado no lo menciona, pero `fakestoreapi.com` responde **HTTP 201 (Created)**, no 200, en un login exitoso. Un check ingenuo `status === 200` habría reportado ~100% de "fallos" de negocio (falso positivo de defecto) aun cuando `http_req_failed` (que k6 calcula sobre el rango 200–399) mostraba 0% de error. Se ajustó el check para aceptar 200/201, y se documenta como hallazgo porque es un caso real de discrepancia entre "la API respondió sin error de transporte" y "el check funcional definido coincide con el contrato real de la API" — vale la pena validarlo siempre contra la API real antes de fijar el criterio de aceptación.
- **Estabilidad de latencia:** la diferencia entre p(90)=524ms y p(99)=659ms es moderada (~135ms), sin colas largas severas, lo que sugiere un comportamiento predecible del servicio bajo esta carga (sin contención evidente de recursos).
- **Alcance de la prueba:** esta ejecución valida el cumplimiento del SLA en el punto de operación exigido (20 TPS), pero **no** determina el punto de quiebre o capacidad máxima del servicio. No se debe interpretar como "el servicio soporta más de 25 TPS sin degradación" sin una prueba de estrés adicional (ver recomendaciones).

## 6. Recomendaciones

1. **Ajustar el threshold de throughput** en el propio script para medirse contra la ventana de plateau (o excluir explícitamente ramp-up/ramp-down del cálculo) en lugar de depender únicamente del promedio global de `http_reqs`.
2. **Ejecutar una prueba de estrés (stress test)** incrementando el TPS objetivo por encima de 25 hasta identificar el punto de quiebre real (dónde p(95) supera 1.5s o la tasa de error supera 3%), para conocer el margen real de capacidad frente al SLA de 20 TPS.
3. **Agregar una prueba de resistencia (soak test)** de mayor duración (30–60 min) a 20–25 TPS constante, para descartar degradación por fugas de memoria, expiración de conexiones o rate-limiting tardío no visibles en una corrida corta de ~3.5 minutos.
4. **Versionar el criterio de aceptación de status HTTP** junto con el contrato de la API (200 vs 201) para evitar falsos positivos/negativos en checks funcionales cuando el servicio cambie de versión.
5. Dado que `fakestoreapi.com` es un servicio público de terceros compartido por múltiples consumidores, **repetir la prueba en distintos horarios** para confirmar que los resultados no están influenciados por carga externa concurrente ajena a esta prueba.

## 7. Evidencia visual adicional: dashboard nativo de k6

Además del análisis anterior (basado en `--out json` y Python), se generó el **dashboard HTML nativo de k6** (`reportes/dashboard-report.html`, habilitado con `K6_WEB_DASHBOARD=true`), que ofrece gráficos interactivos de VUs, TPS, latencias y tasa de error a lo largo del tiempo directamente desde el propio motor de k6, sin dependencias externas. Se incluye como evidencia complementaria y reproducible con una sola variable de entorno (ver README). El gráfico `vus_vs_tps.png` (Python) se mantiene porque permite anotar explícitamente la línea de SLA (20 TPS) y aislar la ventana de estado estable, algo que el dashboard nativo no expone de forma directa.
