import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

/**
 * Configuración de conexión. La usan la app y la CLI de migraciones.
 * synchronize: false SIEMPRE: el esquema cambia solo con migraciones versionadas
 * (como Flyway/Liquibase en Spring), nunca "adivinando" desde las entidades.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
