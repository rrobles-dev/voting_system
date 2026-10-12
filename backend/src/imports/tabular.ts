import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';

/**
 * Lectura de planillas: Excel (.xlsx) o CSV.
 *
 * Detalle de negocio importante: Excel en español (Chile incluido) usa ";" como
 * separador de CSV, porque la coma es el separador decimal. Un CSV guardado desde
 * Excel en un computador chileno llega con ";". Por eso el separador se detecta solo.
 */
export type Row = Record<string, string>;
export interface Table { rows: Row[]; headers: string[] }

/** "Correo electrónico " → "correo_electronico": sin tildes, minúsculas, sin espacios. */
export function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Valor de una celda de exceljs como texto (maneja hipervínculos, texto enriquecido y fórmulas). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('text' in v && typeof v.text === 'string') return v.text;                 // hipervínculo (ej. un correo)
    if ('richText' in v) return v.richText.map((t) => t.text).join('');            // texto con formato
    if ('result' in v) return v.result == null ? '' : String(v.result);           // fórmula
    return '';
  }
  return String(v);
}

async function readXlsx(buffer: Buffer, preferredSheet: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  // Usa la hoja con el nombre esperado; si no existe, la primera que no sea de instrucciones.
  const sheet = wb.worksheets.find((s) => normalizeHeader(s.name) === normalizeHeader(preferredSheet))
    ?? wb.worksheets.find((s) => !normalizeHeader(s.name).startsWith('instruc'));
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs indexa desde 1
    out.push(values.map((v) => cellText(v).trim()));
  });
  return out;
}

function readCsv(buffer: Buffer): string[][] {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  return parse(text, { delimiter, skip_empty_lines: true, trim: true, relax_column_count: true });
}

export async function readTable(buffer: Buffer, filename: string, preferredSheet: string): Promise<Table> {
  const isXlsx = /\.xlsx$/i.test(filename);
  if (/\.xls$/i.test(filename)) throw new Error('Formato .xls antiguo no soportado: guarda el archivo como .xlsx o .csv');
  const matrix = isXlsx ? await readXlsx(buffer, preferredSheet) : readCsv(buffer);
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = matrix[0].map(normalizeHeader);
  const rows = matrix.slice(1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}

/** Busca el valor de una columna aceptando varios nombres (español e inglés). */
export function pick(row: Row, aliases: string[]): string {
  for (const a of aliases) if (row[a] !== undefined && row[a] !== '') return row[a];
  return '';
}

export function hasAny(headers: string[], aliases: string[]): boolean {
  return aliases.some((a) => headers.includes(a));
}
