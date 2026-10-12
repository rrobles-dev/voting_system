# Sistema de votación a distancia

Plataforma para que una asociación gremial elija su directorio en línea: cada empresa socia recibe un código personal por correo, vota desde cualquier dispositivo y la comisión electoral obtiene resultados auditables sin poder saber por quién votó cada empresa.

Reconstrucción, con datos ficticios, de un sistema que diseñé y operé en una asociación de proveedores mineros, donde la participación subió de ~70% (voto manual por mensajero) a un récord de 85%.

## El problema de negocio

Una elección gremial tiene tres exigencias que tiran en direcciones opuestas:

| Exigencia | Riesgo si se ignora |
|---|---|
| **Secreto del voto** | Nadie vota con libertad si la directiva puede ver su elección |
| **Un voto por empresa** | Sin control de duplicados, el resultado no vale |
| **Auditoría humana** | Si no se puede verificar, la asamblea no acepta el resultado |

La solución central es **separar dos registros que nunca se cruzan**:

```text
Participation  →  QUIÉN votó y cuándo     (sin la selección)
Ballot         →  QUÉ se votó             (sin el votante, con hora truncada)
```

El votante recibe un **código de recibo**. Con él puede verificar que su voto fue contado; es el único vínculo entre su identidad y su boleta, y solo lo tiene él.

## Reglas implementadas (v1)

- Un voto por empresa, con padrón entregado por el admin (CSV). Las empresas sin cuotas al día quedan bloqueadas (`eligible=false`).
- Códigos de 9 caracteres (configurable) con mayúsculas y minúsculas, sin caracteres ambiguos (`0/O`, `1/l/I`). Se guardan hasheados con HMAC, nunca en claro.
- Varios cargos por proceso, cada uno con cupos y mínimo/máximo de marcas.
- Apertura y cierre automáticos por fecha, con avisos por correo.
- **Sin tendencias durante la votación**: la API rechaza consultar resultados si el proceso no está cerrado. Durante la votación solo se ve la participación (quién votó, no qué).
- Recordatorios a quienes no han votado y reemisión de código (invalida el anterior).
- Empates en el último cupo: el sistema los **detecta y marca**; se resuelven fuera del sistema según el reglamento.
- Anulación con **control dual**: la solicita el Admin con el recibo del votante y la aprueba el Auditor. La boleta no se borra, queda anulada, y el votante recibe un código nuevo.
- Log de auditoría **encadenado por hash**: alterar o borrar un evento rompe la cadena y el sistema lo detecta.
- IP y user-agent cifrados (AES-256-GCM). Solo el Auditor los descifra, indicando un motivo que queda registrado.
- Reportes CSV: resultados, boletas para recuento manual (sin votante) y participación.

## Stack y por qué

| Capa | Tecnología | Si vienes de Spring Boot |
|---|---|---|
| API | **NestJS** | Módulos, inyección de dependencias, decoradores. `@Controller`/`@Injectable` ≈ `@RestController`/`@Service` |
| ORM | **TypeORM** | Equivale a JPA/Hibernate: `@Entity`, `@Column`, `@ManyToOne`, `transaction()` ≈ `@Transactional` |
| Migraciones | TypeORM CLI | Equivale a Flyway/Liquibase. `synchronize` siempre apagado |
| Validación | class-validator | `@IsString()`, `@Min()` ≈ Bean Validation (`@NotNull`, `@Min`) |
| Auth (v1) | Guard + API key por rol | `@Roles('ADMIN')` ≈ `@PreAuthorize`. En v2 se reemplaza por Keycloak/JWT sin cambiar los endpoints |
| Jobs | @nestjs/schedule | `@Cron` ≈ `@Scheduled` |
| BD | PostgreSQL | Transacciones y locks reales: necesarios para "un código = un voto" |
| Front | React 18 + TypeScript + Vite | |
| Gráficos | Recharts | |
| E2E | **Playwright** | Mismas pruebas en móvil, tablet y escritorio |

**¿Por qué TypeORM y no Prisma?** Prisma ofrece un esquema declarativo muy cómodo y tipos generados excelentes, pero depende de binarios nativos para su motor. TypeORM es JavaScript puro y su modelo (entidades con decoradores, repositorios, `EntityManager`) es casi idéntico a JPA, lo que hace el código fácil de leer para cualquiera que venga de Java. Ambos son opciones válidas y muy usadas con NestJS.

## Decisiones técnicas que vale la pena mirar

1. **Consumo atómico del código** (`voting.service.ts`): `UPDATE access_code SET status='USED' WHERE id=? AND status='ACTIVE'`. Si dos pestañas envían al mismo tiempo, solo una afecta la fila. Es control de concurrencia optimista, sin bloquear la tabla. El smoke test lo comprueba con dos envíos simultáneos.
2. **Todo el voto en una transacción**: consumir código, registrar participación, guardar boleta y escribir el log. Si se corta la conexión, no queda nada a medias y el votante simplemente reintenta. Por eso "error de conexión" no requiere anulación.
3. **HMAC en vez de bcrypt para los códigos**: bcrypt usa un salt aleatorio por fila, lo que impide buscar `WHERE codeHash = ?`. HMAC con un secreto del servidor (pepper) permite la búsqueda e impide que alguien con una copia de la base pruebe códigos offline.
4. **Mensajes de error genéricos**: "código inválido, ya utilizado o fuera de plazo" no revela cuál de los tres casos es, para no ayudar a quien intenta adivinar códigos.
5. **JSON canónico en el log**: Postgres `jsonb` reordena las claves, así que el hash se calcula sobre el JSON con claves ordenadas.
6. **Rate limit configurable** (`VOTING_RATE_LIMIT`): varios votantes pueden compartir IP (misma oficina, asamblea presencial). Un límite muy estricto bloquearía a votantes legítimos.

## Correr en local

Requisitos: Node 20+, Docker.

```bash
# 1. Infraestructura (Postgres + Mailpit)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
echo 'EXPOSE_CODES=true' >> .env   # solo desarrollo: la API devuelve los códigos emitidos
npm install
npm run migration:run              # crea las tablas
npm run seed                       # elección de ejemplo con 10 empresas
npm run start:dev                  # API en http://localhost:3000/api

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

- **Votante**: http://localhost:5173
- **Comisión**: http://localhost:5173/admin (clave `admin-dev-key`; auditor: `auditor-dev-key`)
- **Correos**: http://localhost:8025

Flujo de prueba: en el panel, abre la elección de ejemplo, pulsa **Emitir códigos** (en modo desarrollo se muestran en pantalla) y luego **Abrir ahora**. Vota con un código desde otra ventana o desde el celular.

## Pruebas

```bash
cd backend && npm test              # unitarias: generación de códigos, hash, cifrado, escrutinio, empates

cd e2e
npm install
npx playwright install chromium
npx playwright test                 # E2E en móvil, tablet y escritorio (backend corriendo con EXPOSE_CODES=true)
npx playwright show-report
```

## API

| Método | Ruta | Rol |
|---|---|---|
| POST | `/api/voting/session` | público (código) |
| POST | `/api/voting/ballot` | público (código) |
| GET | `/api/voting/receipt/:receipt` | público |
| GET/POST | `/api/admin/elections` | Admin |
| POST | `/api/admin/elections/:id/voters/import` | Admin |
| POST | `/api/admin/elections/:id/codes/issue` | Admin |
| POST | `/api/admin/elections/:id/voters/:voterId/reissue` | Admin |
| POST | `/api/admin/elections/:id/open` · `/close` · `/tally` | Admin |
| POST | `/api/admin/elections/:id/reminders` | Admin |
| GET | `/api/admin/elections/:id/participation` | Admin, Auditor |
| GET | `/api/admin/elections/:id/results` | Admin, Auditor (solo cerrada) |
| GET | `/api/admin/elections/:id/reports/{results,ballots,participation}.csv` | Admin, Auditor |
| POST | `/api/admin/elections/:id/annulments` | Admin |
| POST | `/api/admin/elections/:id/annulments/:aid/approve` · `/reject` | Auditor |
| GET | `/api/admin/elections/:id/audit` · `/audit/verify` | Admin, Auditor |

## Hoja de ruta

- **v2**: textos, colores y logo configurables por proceso; asistente de configuración con plantillas; ponderación de votos sin riesgo de reidentificación; informe PDF y presentación de resultados; Keycloak/JWT; purga automática según `retentionDays`.
- **v3**: resumen narrativo del proceso generado con IA para el informe final.
