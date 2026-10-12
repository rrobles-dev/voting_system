import { expect, request, test, Page, Locator } from '@playwright/test';
import path from 'path';

const API = 'http://localhost:3000/api';
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'admin-dev-key';
const ADMIN = { 'x-api-key': ADMIN_KEY };
const fixture = (f: string) => path.join(__dirname, '..', 'fixtures', f);
const local = (ms: number) => { const d = new Date(Date.now() + ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

async function login(page: Page, to = '/admin') {
  await page.goto(to);
  await page.getByLabel('Clave').fill(ADMIN_KEY);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

async function fillCargo(cargo: Locator, seats: string, min: string, max: string) {
  await cargo.getByLabel('Cupos').fill(seats);
  await cargo.getByLabel('Mín. marcas').fill(min);
  await cargo.getByLabel('Máx. marcas').fill(max);
}

/** Lo obligatorio del formulario: nada viene prellenado, así que todo se elige explícitamente. */
async function fillBasics(page: Page, title: string, opening: 'Automática' | 'Manual' = 'Manual', ref: 'RUT' | 'Otro código' = 'Otro código') {
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Apertura', { exact: true }).fill(local(3600_000));
  await page.getByLabel('Cierre', { exact: true }).fill(local(4 * 86400_000));
  await page.getByRole('radiogroup', { name: 'Modo de apertura' }).getByLabel(new RegExp(opening)).check();
  await page.getByRole('radiogroup', { name: 'Modo de cierre' }).getByLabel(/Automático/).check();
  await page.getByLabel('Si al abrir hay votantes habilitados sin código').selectOption('ISSUE');
  await page.getByRole('radiogroup', { name: 'Tipo de identificador' }).getByLabel(new RegExp(ref)).check();
}

test('el formulario empieza vacío y no deja revisar sin completar lo esencial', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Nuevo proceso' }).click();
  const cargo1 = page.getByRole('group', { name: 'Cargo 1' });
  await expect(cargo1.getByLabel('Nombre', { exact: true })).toHaveValue('');
  await expect(cargo1.getByLabel('Cupos')).toHaveValue('');
  await expect(page.getByRole('radiogroup', { name: 'Modo de apertura' }).getByRole('radio', { checked: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Revisar antes de crear' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Falta el título');
  await expect(alert).toContainText('Elige cómo se abre la votación');
  await expect(alert).toContainText('Elige cómo se cierra la votación');
  await expect(alert).toContainText('Cargo 1: falta el nombre');
  await expect(alert).toContainText('Elige el tipo de identificador');
});

test('crear con archivos (formato Excel chileno), revisar y confirmar', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Nuevo proceso' }).click();
  await fillBasics(page, `Archivos ${info.project.name} ${Date.now()}`);

  // Los candidatos crean los cargos, pero cupos y marcas quedan vacíos a propósito
  await page.getByLabel('Archivo de candidatos').setInputFiles(fixture('candidatos-excel-chile.csv'));
  await expect(page.getByText('5 candidato(s) cargados en 2 cargo(s)')).toBeVisible();
  const cargo1 = page.getByRole('group', { name: 'Cargo 1' });
  const cargo2 = page.getByRole('group', { name: 'Cargo 2' });
  await expect(cargo1.getByLabel('Nombre', { exact: true })).toHaveValue('Directorio');
  await expect(cargo1.getByLabel('Cupos')).toHaveValue('');
  await expect(cargo2.getByLabel('Nombre', { exact: true })).toHaveValue('Tesorería');
  await fillCargo(cargo1, '2', '1', '2');
  await fillCargo(cargo2, '1', '1', '1');

  await page.getByLabel('Archivo de padrón').setInputFiles(fixture('padron-excel-chile.csv'));
  await expect(page.getByText('3 empresas, 2 habilitadas, 1 bloqueadas')).toBeVisible();

  // Pantalla de revisión
  await page.getByRole('button', { name: 'Revisar antes de crear' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa el proceso antes de crearlo' })).toBeVisible();
  await expect(page.getByText('cada votante marca entre 1 y 2')).toBeVisible();
  await expect(page.locator('.review-position').first()).toContainText('Ana Pérez');

  // Volver a editar conserva todo
  await page.getByRole('button', { name: 'Volver a editar' }).click();
  await expect(cargo1.getByLabel('Cupos')).toHaveValue('2');
  await page.getByRole('button', { name: 'Revisar antes de crear' }).click();
  await page.getByRole('button', { name: 'Confirmar y crear proceso' }).click();

  await expect(page.getByText('3 en el padrón (2 habilitados)')).toBeVisible();
  await page.getByRole('button', { name: 'Emitir códigos' }).click();
  await expect(page.getByText(/Se emitieron 2 código\(s\)/)).toBeVisible();
});

test('un padrón con errores muestra todos los problemas y no deja avanzar', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Nuevo proceso' }).click();
  await page.getByRole('radiogroup', { name: 'Tipo de identificador' }).getByLabel(/Otro código/).check();
  await page.getByLabel('Archivo de padrón').setInputFiles(fixture('padron-con-errores.csv'));
  await expect(page.getByText('falta la empresa')).toBeVisible();
  await expect(page.getByText('correo inválido (malo)')).toBeVisible();
  await page.getByRole('button', { name: 'Revisar antes de crear' }).click();
  await expect(page.getByRole('alert')).toContainText('El padrón tiene errores');
});

async function draftViaApi(title: string) {
  const api = await request.newContext();
  const e = await (await api.post(`${API}/admin/elections`, {
    headers: ADMIN,
    data: {
      title, opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 86400_000).toISOString(),
      autoOpen: false, positions: [{ name: 'Directorio', seats: 1, minSelection: 1, maxSelection: 1, candidates: [{ name: 'Ana' }, { name: 'Beto' }] }],
    },
  })).json();
  return { api, id: e.id as string };
}

test('editar un proceso en borrador: revisar, confirmar y queda en la consola', async ({ page }, info) => {
  const { id } = await draftViaApi(`Editar ${info.project.name} ${Date.now()}`);
  await login(page, `/admin/${id}`);
  await expect(page.getByText('sin padrón cargado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emitir códigos' })).toBeDisabled();

  await page.getByRole('button', { name: 'Editar proceso' }).click();
  const cargo1 = page.getByRole('group', { name: 'Cargo 1' });
  await expect(cargo1.getByRole('textbox').last()).toHaveValue('Ana\nBeto');
  await cargo1.getByRole('textbox').last().fill('Ana\nBeto Salas\nCaro');
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await expect(page.locator('.review-position')).toContainText('Beto Salas');
  await page.getByRole('button', { name: 'Confirmar cambios' }).click();
  await expect(page.getByText('Cambios guardados y registrados en la consola')).toBeVisible();
  await page.getByRole('tab', { name: 'Consola' }).click();
  await expect(page.getByText('Proceso editado')).toBeVisible();
});

test('con la votación abierta: agregar un votante exige motivo y no se puede editar el proceso', async ({ page }, info) => {
  const { api, id } = await draftViaApi(`En curso ${info.project.name} ${Date.now()}`);
  await api.post(`${API}/admin/elections/${id}/voters`, { headers: ADMIN, data: { ref: '1', organization: 'Uno', email: 'uno@x.org' } });
  await api.post(`${API}/admin/elections/${id}/open`, { headers: ADMIN });
  await login(page, `/admin/${id}`);

  await expect(page.getByRole('button', { name: 'Editar proceso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reenviar códigos a pendientes' })).toBeVisible();

  await page.getByRole('button', { name: '+ Agregar votante' }).click();
  await page.getByLabel('RUT o ID').fill('2');
  await page.getByLabel('Empresa').fill('Empresa Dos');
  await page.getByLabel('Correo').fill('dos@example.org');
  await page.getByLabel(/^Motivo/).fill('Regularizó su cuota hoy');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Empresa Dos agregada')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Empresa Dos/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Consola' }).click();
  await expect(page.getByText('Votante agregado').first()).toBeVisible();
  await expect(page.getByText('Código emitido').first()).toBeVisible();
});

test('padrón con RUT: valida el dígito verificador y detecta el mismo RUT escrito distinto', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Nuevo proceso' }).click();
  await page.getByRole('radiogroup', { name: 'Tipo de identificador' }).getByLabel(/RUT chileno/).check();
  await page.getByLabel('Archivo de padrón').setInputFiles(fixture('padron-rut-problemas.csv'));
  await expect(page.getByText('RUT inválido (76.666.666-6)')).toBeVisible();
  await expect(page.getByText('identificador repetido (76111111-6, ya está en la fila 2)')).toBeVisible();
  await expect(page.getByText(/correo repetido \(dup@example.org/)).toBeVisible();

  // El mismo archivo como "otro código": el RUT con DV incorrecto ya no es error
  await page.getByRole('radiogroup', { name: 'Tipo de identificador' }).getByLabel(/Otro código/).check();
  await expect(page.getByText('RUT inválido')).toHaveCount(0);
});

test('bug reportado: "Habilitar" con la votación abierta pide el motivo en la página y funciona', async ({ page }, info) => {
  const { api, id } = await draftViaApi(`Habilitar ${info.project.name} ${Date.now()}`);
  await api.post(`${API}/admin/elections/${id}/voters`, { headers: ADMIN, data: { ref: 'S1', organization: 'Uno', email: 'uno@x.org' } });
  await api.post(`${API}/admin/elections/${id}/voters`, { headers: ADMIN, data: { ref: 'S2', organization: 'Bloqueada SpA', email: 'blo@x.org', eligible: false } });
  await api.post(`${API}/admin/elections/${id}/open`, { headers: ADMIN });
  await login(page, `/admin/${id}`);

  await page.getByRole('button', { name: 'Bloqueados', exact: true }).click();
  await page.getByRole('row', { name: /Bloqueada SpA/ }).getByRole('button', { name: 'Habilitar' }).click();
  const panel = page.getByRole('dialog', { name: 'Habilitar a Bloqueada SpA' });
  await expect(panel.getByRole('button', { name: 'Habilitar' })).toBeDisabled(); // sin motivo no se puede
  await panel.getByLabel(/^Motivo/).fill('Regularizó su cuota hoy');
  await panel.getByRole('button', { name: 'Habilitar' }).click();
  await expect(page.getByText('Bloqueada SpA habilitada; se le envió su código')).toBeVisible();
  await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
  await expect(page.getByRole('row', { name: /Bloqueada SpA/ })).toBeVisible();
});

test('bug reportado: agregar un votante con el mismo RUT escrito distinto o el mismo correo se rechaza', async ({ page }, info) => {
  const api = await request.newContext();
  const e = await (await api.post(`${API}/admin/elections`, {
    headers: ADMIN,
    data: {
      title: `Duplicados ${info.project.name} ${Date.now()}`, refType: 'RUT', autoOpen: false,
      opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 86400_000).toISOString(),
      positions: [{ name: 'Directorio', seats: 1, minSelection: 1, maxSelection: 1, candidates: [{ name: 'Ana' }, { name: 'Beto' }] }],
    },
  })).json();
  await api.post(`${API}/admin/elections/${e.id}/voters`, { headers: ADMIN, data: { ref: '76.666.666-3', organization: 'Filtros Mineros SpA', email: 'filtros@example.org' } });
  await login(page, `/admin/${e.id}`);

  await page.getByRole('button', { name: '+ Agregar votante' }).click();
  await page.getByLabel('RUT o ID').fill('76666666-3');
  await page.getByLabel('Empresa').fill('Filtros Mineros SpA');
  await page.getByLabel('Correo').fill('otro@example.org');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ya existe un votante con el identificador 76666666-3');

  await page.getByLabel('RUT o ID').fill('76.111.111-6');
  await page.getByLabel('Correo').fill('FILTROS@example.org');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ya está asignado a Filtros Mineros SpA');
});
