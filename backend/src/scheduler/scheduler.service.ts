import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual, MoreThan } from 'typeorm';
import { AuditEvent, Election, ElectionStatus } from '../database/entities';
import { AuditService } from '../audit/audit.service';
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

  constructor(private ds: DataSource, private elections: ElectionsService, private audit: AuditService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const now = new Date();
    const repo = this.ds.getRepository(Election);
    // Solo las que tienen apertura automática; las demás esperan el botón "Abrir ahora"
    const toOpen = await repo.findBy({ status: ElectionStatus.DRAFT, autoOpen: true, opensAt: LessThanOrEqual(now), closesAt: MoreThan(now) });
    // Solo cierra sola si tiene cierre automático; con cierre manual espera a la comisión
    const toClose = await repo.findBy({ status: ElectionStatus.OPEN, autoClose: true, closesAt: LessThanOrEqual(now) });

    for (const e of toOpen) {
      // Sin padrón, o faltando códigos con política BLOCK, transition lo rechaza.
      // Se reintenta cada minuto, pero el aviso queda en la consola UNA sola vez.
      await this.elections.transition(e.id, ElectionStatus.OPEN, 'SYSTEM').catch(async (err) => {
        this.logger.warn(`${e.title}: ${err.message}`);
        const already = await this.ds.getRepository(AuditEvent).exist({ where: { electionId: e.id, type: 'AUTO_OPEN_BLOCKED' } });
        if (!already) {
          await this.ds.transaction((em) => this.audit.log(em, e.id, 'AUTO_OPEN_BLOCKED', 'SYSTEM', { reason: err.message }));
        }
      });
    }
    for (const e of toClose) {
      await this.elections.transition(e.id, ElectionStatus.CLOSED, 'SYSTEM').catch((err) => this.logger.error(err.message));
    }
  }
}
