import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Election, ElectionStatus, Voter } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { MESSAGES } from '../common/messages';
import { CreateElectionDto } from './elections.dto';

/**
 * Máquina de estados de una elección. Solo se permiten estas transiciones:
 *   DRAFT → OPEN → CLOSED → TALLIED
 * Cualquier otra (p. ej. reabrir una cerrada) se rechaza.
 * CLOSED → TALLIED no pasa por aquí: lo hace ActasService.publish, porque
 * escrutar sin congelar el acta no debe ser posible.
 */
const TRANSITIONS: Record<ElectionStatus, ElectionStatus[]> = {
  DRAFT: [ElectionStatus.OPEN],
  OPEN: [ElectionStatus.CLOSED],
  CLOSED: [],
  TALLIED: [],
};

@Injectable()
export class ElectionsService {
  constructor(private ds: DataSource, private audit: AuditService, private mail: MailService) {}

  async create(dto: CreateElectionDto) {
    if (new Date(dto.closesAt) <= new Date(dto.opensAt)) {
      throw new BadRequestException('El cierre debe ser posterior a la apertura');
    }
    for (const p of dto.positions) {
      const max = p.maxSelection ?? p.seats;
      if ((p.minSelection ?? 0) > max) throw new BadRequestException(`${p.name}: mínimo mayor que máximo`);
      if (max > p.candidates.length) throw new BadRequestException(`${p.name}: máximo mayor que candidatos`);
    }

    // transaction(): equivale a @Transactional en Spring. Si algo lanza, rollback de todo.
    const id = await this.ds.transaction(async (em) => {
      const election = em.create(Election, {
        title: dto.title,
        description: dto.description ?? null,
        opensAt: new Date(dto.opensAt),
        closesAt: new Date(dto.closesAt),
        codeLength: dto.codeLength ?? 9,
        quorumPercent: dto.quorumPercent ?? null,
        retentionDays: dto.retentionDays ?? 90,
        // cascade: true en la entidad → guardar la elección guarda cargos y candidatos
        positions: dto.positions.map((p, i) => ({
          name: p.name,
          seats: p.seats,
          minSelection: p.minSelection ?? 0,
          maxSelection: p.maxSelection ?? p.seats,
          sortOrder: i,
          candidates: p.candidates.map((c, j) => ({ name: c.name, detail: c.detail ?? null, sortOrder: j })),
        })),
      });
      const saved = await em.save(election);
      await this.audit.log(em, saved.id, 'ELECTION_CREATED', 'ADMIN', { title: dto.title });
      return saved.id;
    });
    return this.get(id);
  }

  list() {
    return this.ds.getRepository(Election).find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string) {
    const e = await this.ds.getRepository(Election).findOne({
      where: { id },
      relations: { positions: { candidates: true } },
      order: { positions: { sortOrder: 'ASC', candidates: { sortOrder: 'ASC' } } },
    });
    if (!e) throw new NotFoundException('Elección no encontrada');
    return e;
  }

  async transition(id: string, to: ElectionStatus, actor: string) {
    const e = await this.get(id);
    if (!TRANSITIONS[e.status].includes(to)) {
      throw new BadRequestException(`No se puede pasar de ${e.status} a ${to}`);
    }
    if (to === ElectionStatus.OPEN) {
      const voters = await this.ds.getRepository(Voter).count({ where: { electionId: id } });
      if (voters === 0) throw new BadRequestException('No se puede abrir sin padrón cargado');
    }
    // Apertura manual anticipada: la fecha de apertura pasa a ser "ahora",
    // si no, el votante tendría la elección abierta pero fuera de plazo.
    const now = new Date();
    const patch: Partial<Election> = { status: to };
    if (to === ElectionStatus.OPEN && e.opensAt > now) patch.opensAt = now;
    if (to === ElectionStatus.CLOSED && e.closesAt > now) patch.closesAt = now;

    await this.ds.transaction(async (em) => {
      await em.update(Election, { id }, patch);
      await this.audit.log(em, id, `ELECTION_${to}`, actor, { from: e.status, to });
    });

    // Avisos de apertura y cierre al padrón elegible, fuera de la transacción:
    // si el SMTP falla, el cambio de estado no debe revertirse.
    if (to === ElectionStatus.OPEN || to === ElectionStatus.CLOSED) {
      const notice = to === ElectionStatus.OPEN ? MESSAGES.email.opened(e.title, e.closesAt) : MESSAGES.email.closed(e.title);
      const voters = await this.ds.getRepository(Voter).find({ where: { electionId: id, eligible: true } });
      await Promise.allSettled(voters.map((v) => this.mail.sendNotice(v.email, notice.subject, notice.body)));
    }
    return { id, status: to };
  }
}
