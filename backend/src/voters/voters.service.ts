import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readTable } from '../imports/tabular';
import { parseRoll } from '../imports/formats';
import { DataSource } from 'typeorm';
import { AccessCode, CodeStatus, Election, ElectionStatus, Participation, Voter } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { generateCode, hashCode } from '../common/crypto';
import { env } from '../common/env';
import { MESSAGES } from '../common/messages';

@Injectable()
export class VotersService {
  constructor(private ds: DataSource, private audit: AuditService, private mail: MailService) {}

  /** Votantes elegibles que aún no tienen una participación vigente (no anulada). */
  private pendingVoters(electionId: string, voterId?: string) {
    const qb = this.ds.getRepository(Voter).createQueryBuilder('v')
      .where('v.electionId = :electionId AND v.eligible = true', { electionId })
      .andWhere((sub) => {
        const q = sub.subQuery().select('1').from(Participation, 'p')
          .where('p.voterId = v.id AND p.annulled = false').getQuery();
        return `NOT EXISTS ${q}`;
      });
    if (voterId) qb.andWhere('v.id = :voterId', { voterId });
    return qb.orderBy('v.organization', 'ASC').getMany();
  }

  /** Lee y valida un padrón (Excel o CSV) sin guardar nada. Lo usa también la validación previa del formulario. */
  async validateRoll(buffer: Buffer, filename: string) {
    let table;
    try {
      table = await readTable(buffer, filename, 'Padrón');
    } catch (e) {
      throw new BadRequestException(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
    const { rows, errors } = parseRoll(table);
    const eligible = rows.filter((r) => r.eligible).length;
    return { rows, errors, summary: { total: rows.length, eligible, notEligible: rows.length - eligible } };
  }

  /**
   * Importa el padrón (Excel o CSV). Valida TODO antes de escribir: si una fila falla,
   * no se importa nada (mejor un error claro que un padrón a medias).
   */
  async importRoll(electionId: string, buffer: Buffer, filename: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.DRAFT) throw new BadRequestException('El padrón solo se carga en estado borrador');

    const { rows, errors, summary } = await this.validateRoll(buffer, filename);
    if (errors.length) throw new BadRequestException({ message: 'El padrón tiene errores', errors });

    await this.ds.transaction(async (em) => {
      await em.delete(Voter, { electionId }); // reemplaza el padrón completo
      await em.insert(Voter, rows.map((r) => ({
        electionId, externalRef: r.ref, organization: r.organization, email: r.email, weight: r.weight, eligible: r.eligible,
      })));
      await this.audit.log(em, electionId, 'ROLL_IMPORTED', 'ADMIN', { total: summary.total, eligible: summary.eligible, file: filename });
    });
    return summary;
  }

  /**
   * Cambios puntuales al padrón: en borrador libremente; con la votación abierta,
   * con motivo obligatorio y registro en la consola. Nunca reemplazo completo con la votación abierta.
   */
  private async editable(electionId: string, reason?: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (![ElectionStatus.DRAFT, ElectionStatus.OPEN].includes(election.status)) {
      throw new BadRequestException('El padrón ya no se puede modificar: la votación cerró');
    }
    if (election.status === ElectionStatus.OPEN && (!reason || reason.trim().length < 10)) {
      throw new BadRequestException('Con la votación abierta, indica el motivo del cambio (mínimo 10 caracteres)');
    }
    return election;
  }

  async addVoter(electionId: string, dto: { ref: string; organization: string; email: string; weight?: number; eligible?: boolean; reason?: string }) {
    const election = await this.editable(electionId, dto.reason);
    const { rows, errors } = parseRoll({
      headers: ['rut_o_id', 'empresa', 'correo', 'peso', 'habilitado'],
      rows: [{ rut_o_id: dto.ref, empresa: dto.organization, correo: dto.email, peso: String(dto.weight ?? 1), habilitado: dto.eligible === false ? 'no' : 'si' }],
    });
    if (errors.length) throw new BadRequestException({ message: 'Datos inválidos', errors: errors.map((e) => e.replace('Fila 2: ', '')) });
    const exists = await this.ds.getRepository(Voter).findOneBy({ electionId, externalRef: rows[0].ref });
    if (exists) throw new BadRequestException(`Ya existe un votante con el identificador ${rows[0].ref}`);

    const voter = await this.ds.transaction(async (em) => {
      const v = await em.save(em.create(Voter, {
        electionId, externalRef: rows[0].ref, organization: rows[0].organization, email: rows[0].email,
        weight: rows[0].weight, eligible: rows[0].eligible,
      }));
      await this.audit.log(em, electionId, 'VOTER_ADDED', 'ADMIN', { voterId: v.id, organization: v.organization, eligible: v.eligible, reason: dto.reason ?? null });
      return v;
    });
    // Con la votación abierta, un votante habilitado recibe su código de inmediato.
    const issued = election.status === ElectionStatus.OPEN && voter.eligible ? await this.issueCodes(electionId, voter.id) : null;
    return { voterId: voter.id, codeIssued: Boolean(issued?.issued), emailed: Boolean(issued?.emailed) };
  }

  async setEligibility(electionId: string, voterId: string, eligible: boolean, reason?: string) {
    const election = await this.editable(electionId, reason);
    const voter = await this.ds.getRepository(Voter).findOneBy({ id: voterId, electionId });
    if (!voter) throw new NotFoundException('Votante no encontrado');
    if (voter.eligible === eligible) throw new BadRequestException(eligible ? 'El votante ya está habilitado' : 'El votante ya está bloqueado');
    if (!eligible) {
      // Su voto ya está en la urna y el sistema no sabe cuál es: bloquearlo ahora no cambiaría nada.
      const voted = await this.ds.getRepository(Participation).existsBy({ electionId, voterId, annulled: false });
      if (voted) throw new BadRequestException('Este votante ya votó: no se puede bloquear');
    }
    await this.ds.transaction(async (em) => {
      await em.update(Voter, { id: voterId }, { eligible });
      if (!eligible) await em.update(AccessCode, { voterId, status: CodeStatus.ACTIVE }, { status: CodeStatus.INVALIDATED });
      await this.audit.log(em, electionId, eligible ? 'VOTER_ENABLED' : 'VOTER_DISABLED', 'ADMIN', { voterId, organization: voter.organization, reason: reason ?? null });
    });
    const issued = eligible && election.status === ElectionStatus.OPEN ? await this.issueCodes(electionId, voterId) : null;
    return { eligible, codeIssued: Boolean(issued?.issued), emailed: Boolean(issued?.emailed) };
  }

  /** Elegibles pendientes de votar que no tienen un código activo. */
  async votersWithoutCode(electionId: string) {
    const pending = await this.pendingVoters(electionId);
    if (!pending.length) return [];
    const active = await this.ds.getRepository(AccessCode).createQueryBuilder('c')
      .select('c.voterId', 'voterId')
      .where('c.voterId IN (:...ids) AND c.status = :s', { ids: pending.map((v) => v.id), s: CodeStatus.ACTIVE })
      .getRawMany<{ voterId: string }>();
    const withCode = new Set(active.map((a) => a.voterId));
    return pending.filter((v) => !withCode.has(v.id));
  }

  /**
   * Emite códigos a los elegibles que aún no votaron.
   * Si un votante ya tenía código activo, se invalida y se emite uno nuevo:
   * nunca hay dos códigos válidos para la misma persona.
   */
  async issueCodes(electionId: string, voterId?: string, opts: { onlyMissing?: boolean; actor?: string } = {}) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (![ElectionStatus.DRAFT, ElectionStatus.OPEN].includes(election.status)) {
      throw new BadRequestException('La elección ya cerró');
    }

    // onlyMissing: no toca a quienes ya tienen un código activo (apertura automática)
    const voters = opts.onlyMissing ? await this.votersWithoutCode(electionId) : await this.pendingVoters(electionId, voterId);
    if (voterId && voters.length === 0) throw new BadRequestException('Votante no elegible o ya votó');
    // Sin destinatarios no hay nada que informar como "emitido": se explica por qué.
    if (voters.length === 0 && !opts.onlyMissing) throw new BadRequestException(await this.whyNobody(electionId));

    const issued: { voterId: string; organization: string; emailed: boolean; code?: string }[] = [];
    for (const v of voters) {
      const code = generateCode(election.codeLength);
      await this.ds.transaction(async (em) => {
        // "Reemitido" solo si de verdad existía un código anterior: la consola debe ser exacta.
        const hadCode = (await em.countBy(AccessCode, { voterId: v.id })) > 0;
        await em.update(AccessCode, { voterId: v.id, status: CodeStatus.ACTIVE }, { status: CodeStatus.INVALIDATED });
        await em.insert(AccessCode, { voterId: v.id, codeHash: hashCode(code, env.codePepper) });
        await this.audit.log(em, electionId, hadCode ? 'CODE_REISSUED' : 'CODE_ISSUED', opts.actor ?? 'ADMIN', { voterId: v.id });
      });
      // El código queda emitido aunque el correo falle: se informa cuántos llegaron para poder reemitir.
      const emailed = await this.mail.sendCode(v.email, v.organization, election.title, code, election)
        .then(() => true).catch(() => false);
      // Solo en desarrollo: se devuelven los códigos para probar sin abrir el correo.
      issued.push({ voterId: v.id, organization: v.organization, emailed, ...(env.exposeCodes ? { code } : {}) });
    }
    return { issued: issued.length, emailed: issued.filter((i) => i.emailed).length, voters: issued };
  }

  /** Participación: quién votó y quién no. NUNCA qué votaron. */
  async participation(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    const voters = await this.ds.getRepository(Voter).find({ where: { electionId }, order: { organization: 'ASC' } });
    const parts = await this.ds.getRepository(Participation).find({ where: { electionId, annulled: false } });
    const votedAt = new Map(parts.map((p) => [p.voterId, p.votedAt]));

    const eligible = voters.filter((v) => v.eligible);
    const voted = eligible.filter((v) => votedAt.has(v.id));
    const percent = eligible.length ? Math.round((voted.length / eligible.length) * 1000) / 10 : 0;
    return {
      status: election.status,
      eligible: eligible.length,
      voted: voted.length,
      percent,
      quorumPercent: election.quorumPercent,
      quorumReached: election.quorumPercent == null ? null : percent >= election.quorumPercent,
      voters: voters.map((v) => ({
        id: v.id,
        ref: v.externalRef,
        organization: v.organization,
        email: v.email,
        eligible: v.eligible,
        votedAt: votedAt.get(v.id) ?? null,
      })),
    };
  }

  async sendReminders(electionId: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.OPEN) throw new BadRequestException('Solo se recuerda con la elección abierta');
    const pending = await this.pendingVoters(electionId);
    if (pending.length === 0) throw new BadRequestException(await this.whyNobody(electionId));
    const msg = MESSAGES.email.reminder(election.title, election);
    const results = await Promise.allSettled(pending.map((v) => this.mail.sendNotice(v.email, msg.subject, msg.body)));
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    if (sent === 0) throw new BadRequestException('No se pudo enviar ningún recordatorio. Revisa el servidor de correo.');
    await this.ds.transaction((em) => this.audit.log(em, electionId, 'REMINDERS_SENT', 'ADMIN', { pending: pending.length, sent }));
    return { sent, pending: pending.length };
  }

  /** Explica por qué no hay destinatarios, en vez de informar un éxito vacío. */
  private async whyNobody(electionId: string) {
    const repo = this.ds.getRepository(Voter);
    const total = await repo.countBy({ electionId });
    if (total === 0) return 'No hay padrón cargado: carga el padrón antes de emitir códigos o enviar avisos';
    const eligible = await repo.countBy({ electionId, eligible: true });
    if (eligible === 0) return 'El padrón no tiene votantes habilitados';
    return 'Todos los votantes habilitados ya votaron';
  }
}
