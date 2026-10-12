/**
 * Datos ficticios: elección de directorio con 5 cupos, 8 candidatos y un padrón
 * de 10 empresas (una sin cuotas al día).
 * Usa los mismos servicios que la API (validaciones + log de auditoría incluidos),
 * en vez de insertar directo en la BD.
 * Uso: npm run seed
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ElectionsService } from '../elections/elections.service';
import { VotersService } from '../voters/voters.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const elections = app.get(ElectionsService);
  const voters = app.get(VotersService);

  const election = await elections.create({
    title: 'Elección de Directorio 2026',
    description: 'Elección de 5 directores para el periodo 2026–2028. Cada empresa socia marca hasta 5 candidatos.',
    opensAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // abre en 1 hora (o manualmente)
    closesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    positions: [{
      name: 'Directorio',
      seats: 5,
      minSelection: 1,
      maxSelection: 5,
      candidates: [
        ['Andrea Fuentes', 'Minera Andina Proveedores'],
        ['Bruno Salas', 'Servicios Geotécnicos del Norte'],
        ['Carolina Vidal', 'Equipos Mineros Atacama'],
        ['Diego Morales', 'Logística Cordillera'],
        ['Elena Rojas', 'Ingeniería y Montaje Pacífico'],
        ['Felipe Araya', 'Seguridad Industrial Sur'],
        ['Gabriela Torres', 'Tecnología Minera Integral'],
        ['Héctor Paredes', 'Insumos y Reactivos Chile'],
      ].map(([name, detail]) => ({ name, detail })),
    }],
  });

  const orgs = [
    'Aceros del Valle', 'Bombas Industriales SpA', 'Cables y Conductores Ltda', 'Drill Tech Chile',
    'Explosivos Seguros SA', 'Filtros Mineros SpA', 'Grúas del Pacífico', 'Hidráulica Norte',
    'Instrumentación Andes', 'Juntas y Sellos Industriales',
  ];
  const csv = ['ref,organization,email,weight,eligible',
    ...orgs.map((o, i) => `76.${100 + i}.${200 + i}-${i},${o},socio${i + 1}@example.org,1,${i !== 9}`)].join('\n');
  const roll = await voters.importCsv(election.id, csv);

  console.log(`Elección creada: ${election.id}`);
  console.log(`Padrón: ${roll.total} empresas (${roll.eligible} elegibles)`);
  console.log('Siguientes pasos en el panel de admin: emitir códigos y abrir la votación.');
  await app.close();
}

main();
