import { expect, test, Page } from '@playwright/test';
import path from 'path';

const ADMIN_KEY = process.env.ADMIN_KEY ?? 'admin-dev-key';
const fixture = (f: string) => path.join(__dirname, '..', 'fixtures', f);

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Clave').fill(ADMIN_KEY);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('button', { name: 'Nuevo proceso' }).click();
}

test('crear un proceso cargando candidatos y padrón desde archivos (formato Excel chileno)', async ({ page }, info) => {
  await login(page);
  await page.getByLabel('Título').fill(`Archivos ${info.project.name} ${Date.now()}`);
  await page.getByLabel('Abrir automáticamente en la fecha de apertura').uncheck();

  // Candidatos: rellenan el cargo existente y agregan uno nuevo
  await page.getByLabel('Archivo de candidatos').setInputFiles(fixture('candidatos-excel-chile.csv'));
  await expect(page.getByText('5 candidato(s) cargados en 2 cargo(s)')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Cargo 1' }).getByRole('textbox').last()).toHaveValue(/Ana Pérez \| Empresa Uno/);
  await expect(page.getByRole('group', { name: 'Cargo 2' }).getByLabel('Nombre', { exact: true })).toHaveValue('Tesorería');
  // Directorio viene con 5 cupos por defecto y el archivo trae 3 candidatos: se ajusta
  const cargo1 = page.getByRole('group', { name: 'Cargo 1' });
  await cargo1.getByLabel('Cupos').fill('2');

  // Padrón: se valida antes de crear
  await page.getByLabel('Archivo de padrón').setInputFiles(fixture('padron-excel-chile.csv'));
  await expect(page.getByText('3 empresas, 2 habilitadas, 1 bloqueadas')).toBeVisible();

  await page.getByRole('button', { name: 'Crear proceso' }).click();
  await expect(page.getByText('Apertura manual')).toBeVisible();
  await expect(page.getByText('3 en el padrón (2 habilitados)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emitir códigos' })).toBeEnabled();

  // El mensaje informa la cantidad real emitida
  await page.getByRole('button', { name: 'Emitir códigos' }).click();
  await expect(page.getByText(/Se emitieron 2 código\(s\)/)).toBeVisible();
});

test('un padrón con errores muestra todos los problemas y no deja crear', async ({ page }) => {
  await login(page);
  await page.getByLabel('Título').fill(`Errores ${Date.now()}`);
  await page.getByRole('group', { name: 'Cargo 1' }).getByRole('textbox').last().fill('Ana\nLuis\nMarta\nPedro\nSara');
  await page.getByLabel('Archivo de padrón').setInputFiles(fixture('padron-con-errores.csv'));
  await expect(page.getByText('falta la empresa')).toBeVisible();
  await expect(page.getByText('correo inválido (malo)')).toBeVisible();
  await page.getByRole('button', { name: 'Crear proceso' }).click();
  await expect(page.getByRole('alert')).toContainText('Corrige el padrón');
});

test('sin padrón no se pueden emitir códigos ni abrir (no hay falso "enviado")', async ({ page }) => {
  await login(page);
  await page.getByLabel('Título').fill(`Sin padrón ${Date.now()}`);
  await page.getByRole('group', { name: 'Cargo 1' }).getByRole('textbox').last().fill('Ana\nLuis\nMarta\nPedro\nSara');
  await page.getByRole('button', { name: 'Crear proceso' }).click();
  await expect(page.getByText('sin padrón cargado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emitir códigos' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Abrir ahora' })).toBeDisabled();
});
