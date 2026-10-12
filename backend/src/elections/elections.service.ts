import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CodesOnOpen, Election, ElectionStatus, Position, Voter } from '../database/entities';
import { VotersService } from '../voters/voters.service';
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
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private mail: MailService,
    private voters: VotersService,
  ) {}

  /** Mismas reglas para crear y para editar: una sola fuente de verdad. */
  private validate(dto: CreateElectionDto) {
    if (new Date(dto.closesAt) <= new Date(dto.opensAt)) {
      throw new BadRequestException('El cierre debe ser posterior a la apertura');
    }
    const names = dto.positions.map((p) => p.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) throw new BadRequestException('Hay cargos con el mismo nombre');
    for (const p of dto.positions) {
      const max = p.maxSelection ?? p.seats;
      if ((p.minSelection ?? 0) > max) throw new BadRequestException(`${p.name}: mínimo mayor que máximo`);
      if (max > p.candidates.length) throw new BadRequestException(`${p.name}: máximo mayor que candidatos`);
      const cands = p.candidates.map((c) => c.name.trim().toLowerCase());
      if (new Set(cands).size !== cands.length) throw new BadRequestException(`${p.name}: hay candidatos repetidos`);
    }
  }

  private fields(dto: CreateElectionDto) {
    return {
      title: dto.title,
      description: dto.description ?? null,
      opensAt: new Date(dto.opensAt),
      closesAt: new Date(dto.closesAt),
      codeLength: dto.codeLength ?? 9,
      quorumPercent: dto.quorumPercent ?? null,
      retentionDays: dto.retentionDays ?? 90,
      autoOpen: dto.autoOpen ?? true,
      autoClose: dto.autoClose ?? true,
      codesOnOpen: dto.codesOnOpen ?? CodesOnOpen.ISSUE,
    };
  }

  private positions(dto: CreateElectionDto) {
    return dto.positions.map((p, i) => ({
      name: p.name.trim(),
      seats: p.seats,
      minSelection: p.minSelection ?? 0,
      maxSelection: p.maxSelection ?? p.seats,
      sortOrder: i,
      candidates: p.candidates.map((c, j) => ({ name: c.name.trim(), detail: c.detail?.trim() || null, sortOrder: j })),
    }));
  }

  async create(dto: CreateElectionDto) {
    this.validate(dto);

    // transaction(): equivale a @Transactional en Spring. Si algo lanza, rollback de todo.
    const id = await this.ds.transaction(async (em) => {
      // cascade: true en la entidad → guardar la elección guarda cargos y candidatos
      const election = em.create(Election, { ...this.fields(dto), positions: this.positions(dto) });
      const saved = await em.save(election);
      await this.audit.log(em, saved.id, 'ELECTION_CREATED', 'ADMIN', { title: dto.title });
      return saved.id;
    });
    return this.get(id);
  }

  /**
   * Editar solo en borrador: aún no hay boletas, así que reemplazar cargos y candidatos es seguro.
   * Los códigos ya emitidos siguen sirviendo: están ligados al votante, no a los candidatos.
   * Una vez abierta, la configuración queda congelada.
   */
  async update(id: string, dto: CreateElectionDto) {
    const before = await this.get(id);
    if (before.status !== ElectionStatus.DRAFT) throw new BadRequestException('Solo se puede editar un proceso en borrador');
    this.validate(dto);
    await this.ds.transaction(async (em) => {
      await em.delete(Position, { electionId: id }); // cascade borra los candidatos
      await em.update(Election, { id }, this.fields(dto));
      for (const p of this.positions(dto)) {
        await em.save(em.create(Position, { ...p, electionId: id }));
      }
      // Resumen legible del cambio en la consola de auditoría
      const summarize = (ps: { name: string; candidates: { name: string }[] }[]) =>
        ps.map((p) => `${p.name}: ${p.candidates.map((c) => c.name).join(', ')}`);
      await this.audit.log(em, id, 'ELECTION_UPDATED', 'ADMIN', {
        before: { title: before.title, opensAt: before.opensAt.toISOString(), closesAt: before.closesAt.toISOString(), positions: summarize(before.positions) },
        after: { title: dto.title, opensAt: dto.opensAt, closesAt: dto.closesAt, positions: summarize(dto.positions) },
      });
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

      // Nunca abrir con votantes habilitados que no tienen con qué votar.
      const missing = await this.voters.votersWithoutCode(id);
      if (missing.length > 0) {
        if (e.codesOnOpen === CodesOnOpen.BLOCK) {
          throw new BadRequestException(`Faltan ${missing.length} código(s) por emitir. Emítelos antes de abrir.`);
        }
        // Se emiten ANTES del aviso de apertura: el correo con el código llega primero.
        await this.voters.issueCodes(id, undefined, { onlyMissing: true, actor });
      }
    }
    // Apertura manual anticipada: la fecha de apertura pasa a ser "ahora",
    // si no, el votante tendría la elección abierta pero fuera de plazo.
    const now = new Date();
    const patch: Partial<Election> = { status: to };
    if (to === ElectionStatus.OPEN && e.opensAt > now) patch.opensAt = now;
    // Cierre anticipado, o cierre manual después de la fecha referencial: se registra la hora real.
    if (to === ElectionStatus.CLOSED && (e.closesAt > now || !e.autoClose)) patch.closesAt = now;

    await this.ds.transaction(async (em) => {
      await em.update(Election, { id }, patch);
      await this.audit.log(em, id, `ELECTION_${to}`, actor, { from: e.status, to });
    });

    // Avisos de apertura y cierre al padrón elegible, fuera de la transacción:
    // si el SMTP falla, el cambio de estado no debe revertirse.
    if (to === ElectionStatus.OPEN || to === ElectionStatus.CLOSED) {
      const notice = to === ElectionStatus.OPEN ? MESSAGES.email.opened(e.title, e) : MESSAGES.email.closed(e.title);
      const voters = await this.ds.getRepository(Voter).find({ where: { electionId: id, eligible: true } });
      await Promise.allSettled(voters.map((v) => this.mail.sendNotice(v.email, notice.subject, notice.body)));
    }
    return { id, status: to };
  }
}
