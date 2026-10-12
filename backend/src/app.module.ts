import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppDataSource } from './database/data-source';
import { AuditModule } from './audit/audit.service';
import { MailModule } from './mail/mail.service';
import { RolesGuard } from './auth/roles.guard';
import { ElectionsController } from './elections/elections.controller';
import { ElectionsService } from './elections/elections.service';
import { VotersController } from './voters/voters.controller';
import { VotersService } from './voters/voters.service';
import { VotingController } from './voting/voting.controller';
import { VotingService } from './voting/voting.service';
import { ResultsController } from './results/results.controller';
import { ResultsService } from './results/results.service';
import { ActasService } from './results/actas.service';
import { PublicResultsController } from './results/public.controller';
import { AnnulmentsController } from './annulments/annulments.controller';
import { AnnulmentsService } from './annulments/annulments.service';
import { SchedulerService } from './scheduler/scheduler.service';

/**
 * Módulo raíz. En una app más grande cada dominio tendría su propio @Module;
 * en v1 los registramos aquí para que el mapa completo quepa en una pantalla.
 * Los guards globales se ejecutan en orden: primero rate limit, luego roles.
 */
@Module({
  imports: [
    // Reutiliza la misma config que la CLI de migraciones: una sola fuente de verdad.
    TypeOrmModule.forRoot(AppDataSource.options),
    AuditModule,
    MailModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [ElectionsController, VotersController, VotingController, ResultsController, PublicResultsController, AnnulmentsController],
  providers: [
    ElectionsService, VotersService, VotingService, ResultsService, ActasService, AnnulmentsService, SchedulerService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
