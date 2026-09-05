# Reto Técnico – Performance Engineering


Prueba de carga sobre el servicio de login de [fakestoreapi.com](https://fakestoreapi.com/auth/login) y análisis de resultados de una ejecución dada.

## Estructura del repositorio

```
.
├── ejercicio1-k6/                 # Ejercicio 1: script de carga y evidencias de ejecución
│   ├── scripts/
│   │   └── login-load-test.js     # script k6 (parametrizado, con thresholds de SLA)
│   ├── data/
│   │   └── usuarios.csv           # credenciales de prueba (parametrización)
│   └── reportes/
│       ├── textSummary.txt        # resumen final de la ejecución (formato k6)
│       ├── summary.json           # resumen completo en JSON (handleSummary)
│       ├── console-output.log     # salida completa de consola de la ejecución
│       ├── dashboard-report.html  # dashboard nativo de k6 (gráficos interactivos, abrir en navegador)
│       ├── vus_vs_tps.csv         # serie temporal VUs vs TPS (buckets de 5s)
│       └── vus_vs_tps.png         # gráfico VUs vs peticiones/segundo (con línea de SLA)
├── conclusiones.md                # hallazgos y conclusiones del Ejercicio 1
├── ejercicio2-analisis/           # Ejercicio 2: análisis del textSummary/gráfico provistos
│   ├── InformeResultados.pdf      # entregable formal (hallazgos, conclusiones, recomendaciones)
│   ├── InformeResultados.docx     # misma versión editable en Word
│   └── assets/                    # imágenes/datos usados en el informe
└── README.md
```

## Tecnologías y versiones utilizadas

| Herramienta | Versión                    | Uso |
|---|-----------------------------|---|
| [k6](https://k6.io) | v2.2.0 (Grafana Labs)       | Motor de ejecución de la prueba de carga |
| Sistema operativo | Windows 11 Pro (10.0.26200) | Entorno de ejecución |
| Python | 3.13.7 (opcional)           | Generación del gráfico VUs vs TPS a partir de las métricas crudas de k6 |
| matplotlib | 3.10.3 (opcional)           | Librería de graficación usada por el script de análisis |


## Instalación de k6

**Windows (winget):**
```powershell
winget install -e --id GrafanaLabs.k6
```

**macOS (brew):**
```bash
brew install k6
```


Verificar instalación:
```bash
k6 version
# Debe reportar v2.2.0 o superior
```

## Ejercicio 1 – Ejecución de la prueba de carga

### Escenario implementado

El script (`ejercicio1-k6/scripts/login-load-test.js`) hace `POST` a `https://fakestoreapi.com/auth/login` con credenciales tomadas de `data/usuarios.csv` (parametrización round-robin entre las 5 filas).

Se usa el ejecutor `ramping-arrival-rate` (modelo de llegada abierto) para controlar directamente el **throughput objetivo** en vez del número de VUs , es la práctica recomendada cuando el SLA se define en TPS, ya que desacopla la tasa de peticiones de la cantidad de usuarios virtuales necesarios para sostenerla:

| Etapa | Duración | Objetivo |
|---|---|---|
| Calentamiento | 30s | 0 → 10 iter/s |
| Rampa de subida | 30s | 10 → 25 iter/s |
| Estado estable | 2 min | 25 iter/s sostenido |
| Rampa de bajada | 30s | 25 → 0 iter/s |

Se apunta a **25 TPS** (25% por encima del mínimo de 20 TPS exigido por el SLA) para dejar margen de seguridad frente a la variabilidad de una API pública de terceros.

### Validaciones (checks) y thresholds (SLA)

- `status` es 200 o 201 (fakestoreapi.com responde **201 Created** en login exitoso, no 200, se valida en el ejercicio 2 el porqué de verificar esto explícitamente).
- La respuesta contiene un `token`.
- `http_req_duration` (tiempo de respuesta) con **p(95) < 1500 ms**  SLA: máx. 1.5s. Se usa el percentil 95 como criterio de umbral (`thresholds`) por ser el estándar de la industria para SLAs de rendimiento, ya que un `max` absoluto es extremadamente sensible a un único outlier de red; el máximo real observado igualmente se reporta en `conclusiones.md`.
- `http_req_failed` con **rate < 3%**  SLA: tasa de error.

### Cómo ejecutar

```bash
cd ejercicio1-k6
k6 run scripts/login-load-test.js
```

Variables de entorno opcionales:

```bash
# Cambiar el host de destino
k6 run -e BASE_URL=https://fakestoreapi.com scripts/login-load-test.js

# Cambiar el TPS objetivo del estado estable (por defecto 25)
k6 run -e TARGET_TPS=30 scripts/login-load-test.js
```

Al finalizar, el script escribe automáticamente (vía `handleSummary`):
- `reportes/textSummary.txt`
- `reportes/summary.json`


> `reportes/vus_vs_tps.png` y `.csv` se generaron post-proceso a partir de la salida `--out json` de k6 para poder correlacionar VUs con TPS a lo largo del tiempo y anotar explícitamente la línea de SLA (20 TPS) y la ventana de estado estable — algo que el dashboard nativo no expone directamente. Para regenerarlos: `k6 run --out json=reportes/raw-metrics.json scripts/login-load-test.js` y luego procesar ese NDJSON agrupando por segundo los puntos de las métricas `http_reqs` y `vus`.

### Resultado obtenido

Ver el detalle completo, interpretación de percentiles y hallazgos en [`conclusiones.md`](./conclusiones.md).

## Ejercicio 2 – Análisis de resultados

Ver [`ejercicio2-analisis/InformeResultados.pdf`](./ejercicio2-analisis/InformeResultados.pdf) (o su versión editable `.docx`) para el análisis del `textSummary.txt` y el gráfico VUs vs. `http_reqs` provistos en el enunciado, incluyendo hallazgos, conclusiones y recomendaciones.
