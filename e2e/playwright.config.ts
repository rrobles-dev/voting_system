import { defineConfig, devices } from '@playwright/test';

/**
 * Mismas pruebas en tres tamaños de pantalla: así verificamos el requisito
 * "responsive para móviles, tablets y PC" con evidencia, no a ojo.
 * Requiere el backend corriendo con EXPOSE_CODES=true (ver README).
 */
const chromePath = process.env.CHROME_PATH; // opcional: usar un Chrome ya instalado

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium' } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } } },
  ],
  webServer: {
    command: 'npm --prefix ../frontend run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
