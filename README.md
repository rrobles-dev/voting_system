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

- Un voto por empresa, con padrón entregado por el admin. Las empresas sin cuotas al día quedan bloqueadas (`habilitado = no`).
- **Tipo de identificador declarado por proceso**: RUT chileno (se normaliza `76.123.456-0` = `76123456-0` y se valida el dígito verificador) u otro código propio (se guarda tal cual; puntos y guiones son significativos). No se adivina mirando el valor: `12345` puede ser un número de socio.
- **Sin duplicados**: ni por identificador (según su tipo) ni por correo, tanto al cargar el padrón como al agregar votantes uno a uno. Dos empresas con el mismo correo recibirían ambos códigos en la misma bandeja.
- **Plantillas descargables** de padrón y candidatos en Excel (.xlsx, con hoja de instrucciones y lista desplegable) y CSV. La carga acepta .xlsx o CSV con separador `,` o `;`, porque **Excel en español guarda los CSV con punto y coma**. Los archivos se validan antes de crear el proceso y se informan **todos** los errores con su número de fila.
- Códigos de 9 caracteres (configurable) con mayúsculas y minúsculas, sin caracteres ambiguos (`0/O`, `1/l/I`). Se guardan hasheados con HMAC, nunca en claro.
- Varios cargos por proceso, cada uno con cupos y mínimo/máximo de marcas.
- **Formulario sin valores prellenados** y **pantalla de revisión** antes de crear: cada dato importante (cupos, marcas, modo de apertura y cierre) se elige explícitamente, y la revisión muestra el proceso tal como lo verán la comisión y los votantes, con avisos (por ejemplo, "hay tantos candidatos como cupos").
- **Edición en borrador**: el proceso completo se puede corregir antes de abrir (por ejemplo, un candidato mal escrito), con revisión previa y registro del cambio en la consola. Una vez abierto, la configuración queda congelada.
- Apertura y cierre **automáticos o manuales**, configurables por separado. Con cierre manual, la fecha de cierre es referencial: se aceptan votos hasta que la comisión cierre, y los correos lo dicen explícitamente.
- **Política de códigos al abrir** (configurable): emitir automáticamente los que falten, o no abrir hasta que la comisión los emita. Aplica tanto a la apertura automática como al botón "Abrir ahora", y un bloqueo queda registrado en la consola.
- **Sin falsos positivos**: emitir códigos o enviar recordatorios sin destinatarios devuelve un error que explica por qué (sin padrón, sin habilitados, todos votaron), y los mensajes informan la cantidad real de códigos y correos enviados.
- **Sin tendencias durante la votación**: la API rechaza consultar resultados si el proceso no está cerrado. Durante la votación solo se ve la participación (quién votó, no qué).
- Recordatorios a quienes no han votado y reemisión de códigos (individual o a todos los pendientes). **No se pueden reenviar los mismos códigos**: el sistema solo guarda su huella, nunca el código, así que reemitir genera uno nuevo e invalida el anterior.
- **Cambios de padrón durante la votación**: agregar un votante o cambiar su habilitación, con motivo obligatorio y registro en la consola; al habilitar a alguien con la votación abierta, recibe su código al instante. No se puede bloquear a quien ya votó ni reemplazar el padrón completo con la votación abierta.
- Empates en el último cupo: el sistema los **detecta y marca**; se resuelven fuera del sistema según el reglamento y el admin registra el resultado.
- Anulación con **control dual**: la solicita el Admin con el recibo del votante y la aprueba el Auditor. La boleta no se borra, queda anulada, y el votante recibe un código nuevo.
- Log de auditoría **encadenado por hash**: alterar o borrar un evento rompe la cadena y el sistema lo detecta.
- IP y user-agent cifrados (AES-256-GCM). Solo el Auditor los descifra, indicando un motivo que queda registrado.
- Reportes CSV: resultados, boletas para recuento manual (sin votante) y participación.

### Del cierre al resultado oficial

| Estado | Qué ve la comisión | Qué puede hacer |
|---|---|---|
| **Cerrada** | Conteo **preliminar**, calculado en vivo desde las boletas | Revisar, verificar, publicar el escrutinio |
| **Escrutada** | El **acta oficial**: copia congelada con huella SHA-256 | Descargar el acta, verificarla, resolver empates, comunicar |

- **Publicar el escrutinio** siempre congela el acta v1 y registra su hash en la cadena de auditoría. Si hay empate, el acta lo deja como *pendiente*.
- **Resolver un empate** (decidido fuera del sistema) genera un **acta complementaria** encadenada a la anterior, con el fundamento escrito. Las actas nunca se editan.
- **Verificar acta vs. boletas** recalcula el conteo desde las boletas y lo compara con el acta: si alguien altera la base después de publicar, aparece la diferencia exacta.
- **Notificar a los socios** y **habilitar resultados públicos** son acciones manuales, bloqueadas mientras haya empates pendientes: no se comunica un resultado que aún no es definitivo.
- Los resultados públicos se insertan en cualquier web con un `<iframe>` (`/resultados/:id`) o se consumen como JSON (`/api/public/elections/:id/results`, CORS abierto). Solo exponen el acta oficial definitiva.

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
6. **Sin diálogos nativos del navegador**: todas las confirmaciones y motivos se piden dentro de la página. `window.confirm()` y `window.prompt()` los bloquean algunos navegadores integrados (como el de VS Code) y los iframes aislados, y el botón parece no hacer nada.
7. **Mensajes basados en lo que realmente ocurrió**: la interfaz arma el mensaje de éxito con los números que devuelve la API (códigos emitidos, correos entregados), nunca con un texto fijo. En un sistema electoral, un "enviado" que no ocurrió es peor que un error.
8. **Rate limit configurable** (`VOTING_RATE_LIMIT`): varios votantes pueden compartir IP (misma oficina, asamblea presencial). Un límite muy estricto bloquearía a votantes legítimos.

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
cd backend && npm test              # unitarias: códigos, hash, cifrado, escrutinio, empates, lectura de Excel/CSV

cd e2e
npm install
npx playwright install chromium
npx playwright test                 # E2E en móvil, tablet y escritorio
# El backend debe correr con EXPOSE_CODES=true y VOTING_RATE_LIMIT=1000:
# la suite completa hace más intentos por minuto desde una sola IP que los que permite el límite normal.
npx playwright show-report
```

## API

| Método | Ruta | Rol |
|---|---|---|
| POST | `/api/voting/session` | público (código) |
| POST | `/api/voting/ballot` | público (código) |
| GET | `/api/voting/receipt/:receipt` | público |
| GET/POST | `/api/admin/elections` | Admin |
| GET | `/api/admin/templates/{padron,candidatos}.{xlsx,csv}` | Admin |
| POST | `/api/admin/templates/padron/validate` · `/candidatos/parse` (multipart `file`) | Admin |
| PUT | `/api/admin/elections/:id` (solo en borrador) | Admin |
| POST | `/api/admin/elections/:id/voters/import` (multipart `file`: .xlsx o .csv; solo en borrador) | Admin |
| POST | `/api/admin/elections/:id/voters` · PATCH `/voters/:voterId/eligibility` · POST `/voters/:voterId/remove` (motivo obligatorio con la votación abierta) | Admin |
| POST | `/api/admin/elections/:id/codes/issue` | Admin |
| POST | `/api/admin/elections/:id/voters/:voterId/reissue` | Admin |
| POST | `/api/admin/elections/:id/open` · `/close` | Admin |
| POST | `/api/admin/elections/:id/tally` (publica escrutinio + acta v1) | Admin |
| POST | `/api/admin/elections/:id/ties/resolve` | Admin |
| GET | `/api/admin/elections/:id/actas` · `/actas/verify` · `/actas/:version/acta.html` | Admin, Auditor |
| POST | `/api/admin/elections/:id/notify-members` · `/public-results` | Admin |
| GET | `/api/public/elections/:id/results` | público (si está habilitado) |
| POST | `/api/admin/elections/:id/reminders` | Admin |
| GET | `/api/admin/elections/:id/participation` | Admin, Auditor |
| GET | `/api/admin/elections/:id/results` | Admin, Auditor (solo cerrada) |
| GET | `/api/admin/elections/:id/reports/{results,ballots,participation}.csv` | Admin, Auditor |
| POST | `/api/admin/elections/:id/annulments` | Admin |
| POST | `/api/admin/elections/:id/annulments/:aid/approve` · `/reject` | Auditor |
| GET | `/api/admin/elections/:id/audit` · `/audit/verify` | Admin, Auditor |

## Hoja de ruta

- **v2**: textos, colores y logo configurables por proceso (también en la página insertable); asistente de configuración con plantillas; ponderación de votos sin riesgo de reidentificación; acta en PDF y presentación de resultados; Keycloak/JWT; purga automática según `retentionDays`.
- **v3**: resumen narrativo del proceso generado con IA para el informe final.
