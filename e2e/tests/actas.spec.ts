import { expect, request, test } from '@playwright/test';

const API = 'http://localhost:3000/api';
const ADMIN = { 'x-api-key': process.env.ADMIN_KEY ?? 'admin-dev-key' };

/**
 * Elección con empate garantizado: 2 cupos, Ana obtiene 3 votos, Beto y Caro 1 cada uno.
 * El segundo cupo queda empatado y debe resolverse fuera del sistema.
 */
async function setupTiedElection(title: string) {
  const api = await request.newContext();
  const e = await (await api.post(`${API}/admin/elections`, {
    headers: ADMIN,
    data: {
      title,
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      positions: [{ name: 'Directorio', seats: 2, minSelection: 1, maxSelection: 2, candidates: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Caro' }] }],
    },
  })).json();
  await api.post(`${API}/admin/elections/${e.id}/voters/import`, { headers: ADMIN, data: { csv: 'ref,organization,email\na,Uno,1@x.org\nb,Dos,2@x.org\nc,Tres,3@x.org' } });
  const codes: string[] = (await (await api.post(`${API}/admin/elections/${e.id}/codes/issue`, { headers: ADMIN })).json()).voters.map((v: { code: string }) => v.code);
  await api.post(`${API}/admin/elections/${e.id}/open`, { headers: ADMIN });
  const pos = e.positions[0];
  const [ana, beto, caro] = pos.candidates.map((c: { id: string }) => c.id);
  for (const [code, sel] of [[codes[0], [ana]], [codes[1], [ana, beto]], [codes[2], [ana, caro]]] as const) {
    await api.post(`${API}/voting/ballot`, { data: { code, selections: { [pos.id]: sel } } });
  }
  await api.post(`${API}/admin/elections/${e.id}/close`, { headers: ADMIN });
  return e.id as string;
}

test('publicar el escrutinio congela el acta y bloquea la comunicación hasta resolver el empate', async ({ page }, info) => {
  const id = await setupTiedElection(`Actas ${info.project.name} ${Date.now()}`);
  await page.goto(`/admin/${id}`);
  await page.getByLabel('Clave').fill(ADMIN['x-api-key']);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // Cerrada: conteo preliminar
  await page.getByRole('tab', { name: 'Resultados' }).click();
  await expect(page.getByText('Conteo preliminar', { exact: false })).toBeVisible();

  // Publicar escrutinio → acta v1 con empate pendiente
  await page.getByRole('button', { name: 'Publicar escrutinio' }).click();
  await expect(page.getByRole('heading', { name: 'Acta oficial · versión 1' })).toBeVisible();
  await expect(page.getByText('Hay empates pendientes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notificar a los socios' })).toBeDisabled();
  await expect(page.getByLabel('Resultados públicos e insertables')).toBeDisabled();

  // Resolver el empate → acta complementaria v2
  await page.locator('.tie-box').getByText('Beto').click();
  await page.getByLabel('Fundamento (queda en el acta)').fill('Caro cede el cupo a Beto de mutuo acuerdo.');
  await page.getByRole('button', { name: 'Emitir acta complementaria' }).click();
  // Confirmación dentro de la página (no un diálogo nativo del navegador)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Emitir acta' }).click();
  await expect(page.getByRole('heading', { name: 'Acta oficial · versión 2' })).toBeVisible();
  await expect(page.getByText('Empate resuelto:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notificar a los socios' })).toBeEnabled();

  // Verificación: cadena íntegra y recuento coincide
  await page.getByRole('button', { name: 'Verificar acta vs. boletas' }).click();
  await expect(page.getByText('el recuento de boletas coincide con el acta')).toBeVisible();

  // Publicar resultados → código insertable + página pública
  // El checkbox refleja el estado del servidor: se marca cuando la API confirma el cambio
  await page.getByLabel('Resultados públicos e insertables').click();
  await expect(page.getByLabel('Resultados públicos e insertables')).toBeChecked();
  await expect(page.locator('.embed textarea')).toHaveValue(/<iframe src=".*\/resultados\//);
  await page.goto(`/resultados/${id}`);
  await expect(page.getByText('Resultados oficiales')).toBeVisible();
  await expect(page.locator('.elected li')).toHaveCount(2);
  await expect(page.locator('.elected')).toContainText('Beto');
  await expect(page.getByText('Cupo asignado por resolución de empate')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('la página pública no muestra nada si los resultados no están publicados', async ({ page }, info) => {
  const id = await setupTiedElection(`Privada ${info.project.name} ${Date.now()}`);
  await page.goto(`/resultados/${id}`);
  await expect(page.getByText('aún no están publicados')).toBeVisible();
});
