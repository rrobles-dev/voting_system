import { expect, request, test, APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3000/api';
const ADMIN = { 'x-api-key': process.env.ADMIN_KEY ?? 'admin-dev-key' };

/**
 * Prepara una elección nueva por API (más rápido y estable que por la UI):
 * 1 cargo, 2 cupos, 3 candidatos, 3 votantes. Devuelve los códigos emitidos.
 */
async function setupElection(api: APIRequestContext, title: string) {
  const election = await (await api.post(`${API}/admin/elections`, {
    headers: ADMIN,
    data: {
      title,
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      positions: [{
        name: 'Directorio', seats: 2, minSelection: 1, maxSelection: 2,
        candidates: [{ name: 'Ana Pérez' }, { name: 'Luis Soto' }, { name: 'Marta Díaz' }],
      }],
    },
  })).json();
  const csv = 'ref,organization,email\nA1,Empresa Uno,uno@example.org\nA2,Empresa Dos,dos@example.org\nA3,Empresa Tres,tres@example.org';
  expect((await api.post(`${API}/admin/elections/${election.id}/voters/import`, { headers: ADMIN, data: { csv } })).ok()).toBeTruthy();
  const issued = await (await api.post(`${API}/admin/elections/${election.id}/codes/issue`, { headers: ADMIN })).json();
  expect(issued.voters[0].code, 'El backend debe correr con EXPOSE_CODES=true').toBeTruthy();
  expect((await api.post(`${API}/admin/elections/${election.id}/open`, { headers: ADMIN })).ok()).toBeTruthy();
  return { id: election.id as string, codes: issued.voters.map((v: { code: string }) => v.code) as string[] };
}

async function expectNoHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'La página no debe desbordar horizontalmente').toBeLessThanOrEqual(0);
}

test('el votante completa el proceso y obtiene su recibo', async ({ page }, info) => {
  const api = await request.newContext();
  const { id, codes } = await setupElection(api, `E2E ${info.project.name} ${Date.now()}`);

  // Bienvenida con explicación
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido al proceso de votación' })).toBeVisible();
  await expect(page.getByText('Ingresa el código personal')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Código
  await page.getByLabel('Código de votación').fill(codes[0]);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // Boleta: instrucciones + tope de selección
  await expect(page.getByText('Votando en representación de')).toBeVisible();
  await expect(page.getByText('Se eligen 2 cupos')).toBeVisible();
  await page.getByText('Ana Pérez').click();
  await page.getByText('Luis Soto').click();
  await expect(page.getByText('2 de 2 marcados')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Marta Díaz/ })).toBeDisabled();
  await expectNoHorizontalScroll(page);

  // Revisión y envío
  await page.getByRole('button', { name: 'Revisar mi voto' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu voto antes de enviarlo' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y enviar voto' }).click();

  // Confirmación con recibo
  await expect(page.getByRole('heading', { name: 'Tu voto fue registrado' })).toBeVisible();
  const receipt = (await page.getByTestId('receipt').textContent())!.trim();
  expect(receipt).toHaveLength(12);
  await expectNoHorizontalScroll(page);

  // Verificación pública del recibo
  await page.goto('/verificar');
  await page.getByLabel('Código de recibo').fill(receipt);
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByText('Tu voto está registrado y será contado.')).toBeVisible();

  // El mismo código ya no sirve
  await page.goto('/');
  await page.getByLabel('Código de votación').fill(codes[0]);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toContainText('Código inválido');

  // La participación sube, pero los resultados siguen bloqueados con la elección abierta
  const part = await (await api.get(`${API}/admin/elections/${id}/participation`, { headers: ADMIN })).json();
  expect(part.voted).toBe(1);
  expect((await api.get(`${API}/admin/elections/${id}/results`, { headers: ADMIN })).status()).toBe(403);
});

test('un código con mayúsculas y minúsculas invertidas es rechazado', async ({ page }, info) => {
  const api = await request.newContext();
  const { codes } = await setupElection(api, `E2E case ${info.project.name} ${Date.now()}`);
  const swapped = [...codes[1]].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  await page.goto('/');
  await page.getByLabel('Código de votación').fill(swapped);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toContainText('Código inválido');
});

test('el panel de la comisión muestra la participación sin tendencias', async ({ page }, info) => {
  const api = await request.newContext();
  const { id } = await setupElection(api, `E2E admin ${info.project.name} ${Date.now()}`);
  await page.goto(`/admin/${id}`);
  await page.getByLabel('Clave').fill(ADMIN['x-api-key']);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('participación', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Resultados' }).click();
  await expect(page.getByText('Los resultados se habilitan al cierre')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
