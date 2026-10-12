import ExcelJS from 'exceljs';
import { normalizeHeader, readTable } from '../src/imports/tabular';
import { normalizeRef, normalizeRut, parseCandidates, parseRoll, refKey, rutCheckDigit, templates } from '../src/imports/formats';

const csv = (s: string) => Buffer.from(s, 'utf8');

describe('lectura de planillas', () => {
  it('normaliza encabezados con tildes, mayúsculas y espacios', () => {
    expect(normalizeHeader(' Correo Electrónico ')).toBe('correo_electronico');
    expect(normalizeHeader('RUT o ID')).toBe('rut_o_id');
  });

  it('detecta separador punto y coma (CSV de Excel en español)', async () => {
    const t = await readTable(csv('rut_o_id;empresa;correo\n1;Ñandú SpA;a@x.cl\n'), 'p.csv', 'Padrón');
    expect(t.rows[0]).toEqual({ rut_o_id: '1', empresa: 'Ñandú SpA', correo: 'a@x.cl' });
  });

  it('acepta separador coma y BOM', async () => {
    const t = await readTable(csv('﻿rut_o_id,empresa,correo\n1,Uno,a@x.cl\n'), 'p.csv', 'Padrón');
    expect(t.headers).toEqual(['rut_o_id', 'empresa', 'correo']);
  });

  it('lee la plantilla .xlsx generada (ida y vuelta)', async () => {
    const t = await readTable(await templates.rollXlsx(), 'plantilla.xlsx', 'Padrón');
    const { rows, errors } = parseRoll(t);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1].eligible).toBe(false);
  });

  it('lee correos que Excel convirtió en hipervínculo', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Padrón');
    ws.addRow(['rut_o_id', 'empresa', 'correo']);
    ws.addRow(['1', 'Uno', { text: 'a@x.cl', hyperlink: 'mailto:a@x.cl' }]);
    const t = await readTable(Buffer.from(await wb.xlsx.writeBuffer()), 'p.xlsx', 'Padrón');
    expect(parseRoll(t).rows[0].email).toBe('a@x.cl');
  });

  it('rechaza el formato .xls antiguo con un mensaje claro', async () => {
    await expect(readTable(csv('x'), 'viejo.xls', 'Padrón')).rejects.toThrow(/xlsx/);
  });
});

describe('parseRoll', () => {
  const roll = (body: string) => readTable(csv(body), 'p.csv', 'Padrón').then(parseRoll);

  it('acepta encabezados en inglés de la v1 y valores sí/no/true/false', async () => {
    const { rows, errors } = await roll('ref,organization,email,eligible\n1,A,a@x.cl,true\n2,B,b@x.cl,No\n3,C,c@x.cl,Sí\n');
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.eligible)).toEqual([true, false, true]);
  });

  it('informa TODOS los errores, con número de fila', async () => {
    const { errors } = await roll('rut_o_id,empresa,correo,peso,habilitado\n1,,malo,0,tal vez\n1,X,x@x.cl,1,si\n');
    expect(errors).toEqual([
      'Fila 2: falta la empresa',
      'Fila 2: correo inválido (malo)',
      'Fila 2: el peso debe ser un entero positivo',
      'Fila 2: "habilitado" debe ser sí o no',
      'Fila 3: identificador repetido (1, ya está en la fila 2)',
    ]);
  });

  it('avisa si falta una columna obligatoria', async () => {
    const { errors } = await roll('empresa,correo\nA,a@x.cl\n');
    expect(errors).toEqual(['Falta la columna "rut_o_id"']);
  });
});

describe('parseCandidates', () => {
  it('agrupa por cargo respetando el orden y usa "Directorio" si no hay cargo', async () => {
    const t = await readTable(csv('cargo;candidato;detalle\nDirectorio;Ana;E1\nTesorería;Luis;\n;Marta;E3\n'), 'c.csv', 'Candidatos');
    const { positions, errors } = parseCandidates(t);
    expect(errors).toEqual([]);
    expect(positions.map((p) => [p.position, p.candidates.map((c) => c.name)])).toEqual([
      ['Directorio', ['Ana', 'Marta']],
      ['Tesorería', ['Luis']],
    ]);
  });

  it('detecta candidatos repetidos en el mismo cargo', async () => {
    const t = await readTable(csv('cargo,candidato\nDirectorio,Ana\nDirectorio,ana\n'), 'c.csv', 'Candidatos');
    expect(parseCandidates(t).errors[0]).toMatch(/repetido/);
  });
});

describe('identificadores según el tipo declarado', () => {
  it('calcula el dígito verificador del RUT (módulo 11, incluido K y 0)', () => {
    expect(rutCheckDigit('76666666')).toBe('3');
    expect(rutCheckDigit('11111111')).toBe('1');
    expect(rutCheckDigit('10000013')).toBe('K');
  });

  it('RUT: distintas escrituras se normalizan a una sola', () => {
    for (const r of ['76.666.666-3', '76666666-3', '76666666 3', ' 76.666.666 - 3 ', '766666663']) {
      expect(normalizeRut(r)).toBe('76666666-3');
    }
  });

  it('RUT: rechaza dígito verificador incorrecto', () => {
    expect(normalizeRut('76.666.666-6')).toBeNull();
  });

  it('CODE: un número de socio NO se trata como RUT', () => {
    expect(normalizeRef('12345', 'CODE')).toBe('12345');
    expect(refKey('12345', 'CODE')).not.toBe(refKey('1234-5', 'CODE'));
  });

  it('CODE: puntos y guiones son significativos; mayúsculas y espacios extremos no', () => {
    expect(refKey('1-23', 'CODE')).not.toBe(refKey('12-3', 'CODE'));
    expect(refKey(' soc-01 ', 'CODE')).toBe(refKey('SOC-01', 'CODE'));
  });
});

describe('duplicados en el padrón', () => {
  const roll = (body: string, type: 'RUT' | 'CODE') => readTable(csv(body), 'p.csv', 'Padrón').then((t) => parseRoll(t, type));

  it('RUT: detecta el mismo RUT escrito con y sin puntos', async () => {
    const { errors } = await roll('rut_o_id,empresa,correo\n76.666.666-3,Filtros,f@x.cl\n76666666-3,Filtros bis,g@x.cl\n', 'RUT');
    expect(errors).toEqual(['Fila 3: identificador repetido (76666666-3, ya está en la fila 2)']);
  });

  it('RUT: informa el dígito verificador inválido', async () => {
    const { errors } = await roll('rut_o_id,empresa,correo\n76.666.666-6,Filtros,f@x.cl\n', 'RUT');
    expect(errors[0]).toMatch(/RUT inválido \(76.666.666-6\)/);
  });

  it('CODE: "12345" y "1234-5" son socios distintos', async () => {
    const { errors } = await roll('rut_o_id,empresa,correo\n12345,A,a@x.cl\n1234-5,B,b@x.cl\n', 'CODE');
    expect(errors).toEqual([]);
  });

  it('detecta el mismo correo aunque cambien las mayúsculas (cualquier tipo)', async () => {
    const { errors } = await roll('rut_o_id,empresa,correo\nS1,A,Socios@X.cl\nS2,B,socios@x.cl\n', 'CODE');
    expect(errors).toEqual(['Fila 3: correo repetido (socios@x.cl, ya está en la fila 2)']);
  });
});
