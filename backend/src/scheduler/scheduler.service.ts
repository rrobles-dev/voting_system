import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual, MoreThan } from 'typeorm';
import { Election, ElectionStatus } from '../database/entities';
import { ElectionsService } from '../elections/elections.service';

/**
 * Apertura y cierre automáticos por fecha. Corre cada minuto.
 * Equivale a @Scheduled(cron = "...") en Spring.
 * Además, castBallot revisa la fecha en cada voto: aunque el cron se atrase,
 * nadie puede votar después de closesAt.
 */
@Injectable()
export class SchedulerService {
  private logger = new Logger(SchedulerService.name);

  constructor(private ds: DataSource, private elections: ElectionsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const now = new Date();
    const repo = this.ds.getRepository(Election);
    const toOpen = await repo.findBy({ status: ElectionStatus.DRAFT, opensAt: LessThanOrEqual(now), closesAt: MoreThan(now) });
    const toClose = await repo.findBy({ status: ElectionStatus.OPEN, closesAt: LessThanOrEqual(now) });

    for (const e of toOpen) {
      // Sin padrón no se abre (transition lo rechaza); se reintenta al minuto siguiente.
      await this.elections.transition(e.id, ElectionStatus.OPEN, 'SYSTEM').catch((err) => this.logger.warn(`${e.title}: ${err.message}`));
    }
    for (const e of toClose) {
      await this.elections.transition(e.id, ElectionStatus.CLOSED, 'SYSTEM').catch((err) => this.logger.error(err.message));
    }
  }
}
