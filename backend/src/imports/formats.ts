import ExcelJS from 'exceljs';
import { hasAny, pick, Table } from './tabular';

/**
 * Formatos de carga del padrón y los candidatos. Las columnas aceptan nombres
 * en español (los de la plantilla) y en inglés (compatibilidad con la v1).
 */
export const ROLL_COLUMNS = {
  ref: ['rut_o_id', 'rut', 'id', 'ref'],
  organization: ['empresa', 'organizacion', 'socio', 'organization'],
  email: ['correo', 'correo_electronico', 'email', 'mail'],
  weight: ['peso', 'votos', 'weight'],
  eligible: ['habilitado', 'habilitada', 'cuotas_al_dia', 'eligible'],
};

export const CANDIDATE_COLUMNS = {
  position: ['cargo', 'position'],
  name: ['candidato', 'nombre', 'name'],
  detail: ['detalle', 'empresa', 'descripcion', 'detail'],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tipo de identificador del votante, declarado por la comisión en cada proceso.
 * No se puede adivinar mirando el valor: "12345" puede ser un número de socio, no un RUT.
 */
export type RefType = 'RUT' | 'CODE';

/** Dígito verificador de un RUT (módulo 11). */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let mul = 2;
  for (const d of body.split('').reverse()) {
    sum += Number(d) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
}

/**
 * RUT: "76.666.666-6", "76666666-6" y "76666666 6" son el mismo → se guarda "76666666-6".
 * Devuelve null si no tiene forma de RUT o el dígito verificador no corresponde.
 */
export function normalizeRut(ref: string): string | null {
  const m = ref.replace(/[.\s]/g, '').toUpperCase().match(/^(\d{1,9})-?([\dK])$/);
  if (!m || rutCheckDigit(m[1]) !== m[2]) return null;
  return `${m[1].replace(/^0+(?=\d)/, '')}-${m[2]}`;
}

/** Valor a guardar según el tipo: el RUT normalizado, o el código tal cual (sin espacios en los extremos). */
export function normalizeRef(ref: string, type: RefType): string {
  return type === 'RUT' ? normalizeRut(ref) ?? ref.trim() : ref.trim();
}

/**
 * Clave para detectar duplicados. En un código propio no se tocan puntos ni guiones
 * (pueden ser significativos: "1-23" y "12-3" son distintos); solo mayúsculas y espacios extremos.
 */
export function refKey(ref: string, type: RefType): string {
  return type === 'RUT' ? normalizeRut(ref) ?? ref.trim().toUpperCase() : ref.trim().toUpperCase();
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const YES = ['si', 'sí', 'true', 'verdadero', '1', 'x', 'yes'];
const NO = ['no', 'false', 'falso', '0'];

export interface RollRow { ref: string; organization: string; email: string; weight: number; eligible: boolean }

/** Valida TODO el padrón y devuelve las filas o la lista completa de errores (no solo el primero). */
export function parseRoll(t: Table, refType: RefType = 'CODE'): { rows: RollRow[]; errors: string[] } {
  const errors: string[] = [];
  for (const [key, aliases] of Object.entries(ROLL_COLUMNS)) {
    if (['weight', 'eligible'].includes(key)) continue; // opcionales
    if (!hasAny(t.headers, aliases)) errors.push(`Falta la columna "${aliases[0]}"`);
  }
  if (errors.length) return { rows: [], errors };
  if (t.rows.length === 0) return { rows: [], errors: ['El archivo no tiene filas de datos'] };

  const seenRef = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const rows: RollRow[] = [];
  t.rows.forEach((r, i) => {
    const line = i + 2; // fila 1 = encabezados
    const rawRef = pick(r, ROLL_COLUMNS.ref);
    const ref = normalizeRef(rawRef, refType);
    const key = refKey(rawRef, refType);
    const organization = pick(r, ROLL_COLUMNS.organization);
    const email = normalizeEmail(pick(r, ROLL_COLUMNS.email));
    const weightRaw = pick(r, ROLL_COLUMNS.weight) || '1';
    const eligibleRaw = (pick(r, ROLL_COLUMNS.eligible) || 'si').toLowerCase();
    if (!rawRef) errors.push(`Fila ${line}: falta el RUT o identificador`);
    else if (refType === 'RUT' && !normalizeRut(rawRef)) errors.push(`Fila ${line}: RUT inválido (${rawRef}): revisa el dígito verificador`);
    if (!organization) errors.push(`Fila ${line}: falta la empresa`);
    if (!EMAIL_RE.test(email)) errors.push(`Fila ${line}: correo inválido${email ? ` (${email})` : ''}`);
    if (!/^[1-9]\d*$/.test(weightRaw)) errors.push(`Fila ${line}: el peso debe ser un entero positivo`);
    if (![...YES, ...NO].includes(eligibleRaw)) errors.push(`Fila ${line}: "habilitado" debe ser sí o no`);
    // Duplicados por identificador normalizado y por correo: una empresa, un voto, una bandeja.
    if (rawRef && seenRef.has(key)) errors.push(`Fila ${line}: identificador repetido (${ref}, ya está en la fila ${seenRef.get(key)})`);
    if (email && seenEmail.has(email)) errors.push(`Fila ${line}: correo repetido (${email}, ya está en la fila ${seenEmail.get(email)})`);
    if (rawRef && !seenRef.has(key)) seenRef.set(key, line);
    if (email && !seenEmail.has(email)) seenEmail.set(email, line);
    rows.push({ ref, organization, email, weight: Number(weightRaw) || 1, eligible: YES.includes(eligibleRaw) });
  });
  return { rows, errors };
}

export interface CandidatesByPosition { position: string; candidates: { name: string; detail?: string }[] }

export function parseCandidates(t: Table): { positions: CandidatesByPosition[]; errors: string[] } {
  const errors: string[] = [];
  if (!hasAny(t.headers, CANDIDATE_COLUMNS.name)) errors.push('Falta la columna "candidato"');
  if (errors.length) return { positions: [], errors };
  const byPosition = new Map<string, CandidatesByPosition>();
  t.rows.forEach((r, i) => {
    const name = pick(r, CANDIDATE_COLUMNS.name);
    const position = pick(r, CANDIDATE_COLUMNS.position) || 'Directorio';
    if (!name) { errors.push(`Fila ${i + 2}: falta el nombre del candidato`); return; }
    const group = byPosition.get(position) ?? { position, candidates: [] };
    if (group.candidates.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      errors.push(`Fila ${i + 2}: candidato repetido en ${position} (${name})`);
    }
    group.candidates.push({ name, detail: pick(r, CANDIDATE_COLUMNS.detail) || undefined });
    byPosition.set(position, group);
  });
  if (byPosition.size === 0 && !errors.length) errors.push('El archivo no tiene candidatos');
  return { positions: [...byPosition.values()], errors };
}

/* ---------- Plantillas descargables ---------- */

const ROLL_HEADERS = ['rut_o_id', 'empresa', 'correo', 'peso', 'habilitado'];
const ROLL_EXAMPLE = [
  ['76.100.200-7', 'Empresa de Ejemplo SpA', 'contacto@ejemplo.cl', 1, 'sí'],
  ['76.300.400-7', 'Servicios de Muestra Ltda', 'socios@muestra.cl', 1, 'no'],
];
const CAND_HEADERS = ['cargo', 'candidato', 'detalle'];
const CAND_EXAMPLE = [
  ['Directorio', 'Nombre Apellido', 'Empresa que representa'],
  ['Directorio', 'Otra Persona', 'Otra empresa'],
];

async function buildXlsx(sheetName: string, headers: string[], example: (string | number)[][], instructions: string[], enumCol?: { col: string; values: string[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de votación';
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  example.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
  ws.columns.forEach((c) => { c.width = 28; });
  if (enumCol) {
    // Lista desplegable: evita errores de tipeo en la columna (ej. "Si", "SI", "s")
    for (let r = 2; r <= 1000; r++) {
      ws.getCell(`${enumCol.col}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${enumCol.values.join(',')}"`],
      };
    }
  }
  const info = wb.addWorksheet('Instrucciones');
  info.getColumn(1).width = 110;
  instructions.forEach((line, i) => {
    const row = info.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 14 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const templates = {
  rollXlsx: () => buildXlsx('Padrón', ROLL_HEADERS, ROLL_EXAMPLE, [
    'Plantilla de padrón',
    'Completa la hoja "Padrón": una fila por empresa socia. Borra las filas de ejemplo.',
    'rut_o_id: identificador único de la empresa. No puede repetirse.',
    '  · Si el proceso usa RUT: se acepta con o sin puntos (76.123.456-0 o 76123456-0) y se valida el dígito verificador.',
    '  · Si usa otro código (número de socio, código interno): se guarda tal cual lo escribas.',
    'empresa: nombre que verá la comisión en el panel de participación.',
    'correo: dirección donde llegará el código de votación. Cada empresa debe tener un correo distinto.',
    'peso: votos que representa la empresa. Déjalo en 1 si es un voto por empresa.',
    'habilitado: "sí" si puede votar (por ejemplo, cuotas al día); "no" para bloquearla.',
    'También puedes guardar el archivo como CSV: el sistema acepta separador coma o punto y coma.',
  ], { col: 'E', values: ['sí', 'no'] }),
  candidatesXlsx: () => buildXlsx('Candidatos', CAND_HEADERS, CAND_EXAMPLE, [
    'Plantilla de candidatos',
    'Completa la hoja "Candidatos": una fila por candidato. Borra las filas de ejemplo.',
    'cargo: nombre del cargo exactamente como lo configuraste en el proceso (ej. "Directorio").',
    'candidato: nombre que verá el votante en la boleta.',
    'detalle: opcional; empresa que representa o una reseña breve.',
    'El orden de las filas es el orden en que aparecerán en la boleta.',
  ]),
  rollCsv: () => '﻿' + [ROLL_HEADERS, ...ROLL_EXAMPLE].map((r) => r.join(',')).join('\n'),
  candidatesCsv: () => '﻿' + [CAND_HEADERS, ...CAND_EXAMPLE].map((r) => r.join(',')).join('\n'),
};
