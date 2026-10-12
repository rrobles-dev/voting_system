import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AccessCode, Ballot, BallotSelection, CodeStatus, Election, ElectionStatus, Participation, Position,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { encrypt, generateReceipt, hashCode, sha256, truncateToHour } from '../common/crypto';
import { env } from '../common/env';
import { validateSelection } from '../results/tally';

// Mensaje genérico a propósito: no revela si el código existe, ya se usó o fue invalidado.
// Así un atacante no puede usar las respuestas para saber qué códigos son reales.
const INVALID_CODE = 'Código inválido, ya utilizado o fuera del periodo de votación';

export interface CastBallotInput {
  code: string;
  selections: Record<string, string[]>; // positionId → candidateIds
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class VotingService {
  constructor(private ds: DataSource, private audit: AuditService, private mail: MailService) {}

  /** Código activo, de votante elegible, en elección abierta y dentro de plazo. */
  private async findActiveCode(code: string, em: EntityManager = this.ds.manager) {
    const found = await em.findOne(AccessCode, {
      where: { codeHash: hashCode(code.trim(), env.codePepper) },
      relations: { voter: { election: true } },
    });
    const now = new Date();
    const e = found?.voter.election;
    if (!found || found.status !== CodeStatus.ACTIVE || !found.voter.eligible || !e
      || e.status !== ElectionStatus.OPEN || now < e.opensAt || now > e.closesAt) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    return found;
  }

  /** Paso 1: el votante ingresa su código y recibe la boleta. No consume el código. */
  async startSession(code: string) {
    const found = await this.findActiveCode(code);
    const election = await this.ds.getRepository(Election).findOneOrFail({
      where: { id: found.voter.electionId },
      relations: { positions: { candidates: true } },
      order: { positions: { sortOrder: 'ASC', candidates: { sortOrder: 'ASC' } } },
    });
    return {
      organization: found.voter.organization,
      election: {
        id: election.id,
        title: election.title,
        description: election.description,
        closesAt: election.closesAt,
        positions: election.positions.map((p) => ({
          id: p.id,
          name: p.name,
          seats: p.seats,
          minSelection: p.minSelection,
          maxSelection: p.maxSelection,
          candidates: p.candidates.map((c) => ({ id: c.id, name: c.name, detail: c.detail })),
        })),
      },
    };
  }

  /**
   * Paso 2: emitir el voto. TODO ocurre en una sola transacción:
   * consumir código + registrar participación + guardar boleta + log.
   * Si algo falla (incluida la conexión), no queda nada a medias: el votante reintenta.
   */
  async castBallot(input: CastBallotInput) {
    const receipt = generateReceipt();
    const now = new Date();

    const result = await this.ds.transaction(async (em) => {
      const code = await this.findActiveCode(input.code, em);
      const electionId = code.voter.electionId;

      // Validar la selección contra las reglas de cada cargo.
      const positions = await em.find(Position, { where: { electionId }, relations: { candidates: true } });
      const unknown = Object.keys(input.selections).filter((pid) => !positions.some((p) => p.id === pid));
      if (unknown.length) throw new BadRequestException('La boleta incluye cargos que no existen');
      for (const p of positions) {
        const err = validateSelection(
          input.selections[p.id] ?? [], p.candidates.map((c) => c.id), p.minSelection, p.maxSelection,
        );
        if (err) throw new BadRequestException(`${p.name}: ${err}`);
      }

      // Consumo atómico del código: UPDATE ... WHERE id = ? AND status = 'ACTIVE'.
      // Si dos pestañas envían a la vez, solo una afecta 1 fila; la otra recibe 0 y falla.
      // Es control de concurrencia optimista: no bloquea la tabla.
      const consumed = await em.update(
        AccessCode, { id: code.id, status: CodeStatus.ACTIVE }, { status: CodeStatus.USED, usedAt: now },
      );
      if (consumed.affected !== 1) throw new ConflictException(INVALID_CODE);

      // QUIÉN: participación, con datos de conexión cifrados.
      await em.insert(Participation, {
        electionId,
        voterId: code.voterId,
        codeId: code.id,
        votedAt: now,
        ipEnc: input.ip ? encrypt(input.ip, env.auditEncKey) : null,
        uaEnc: input.userAgent ? encrypt(input.userAgent, env.auditEncKey) : null,
      });

      // QUÉ: boleta sin referencia al votante y con hora truncada.
      const ballot = await em.save(Ballot, { electionId, receiptHash: sha256(receipt), castHour: truncateToHour(now) });
      const candidateIds = Object.values(input.selections).flat();
      if (candidateIds.length) {
        await em.insert(BallotSelection, candidateIds.map((candidateId) => ({ ballotId: ballot.id, candidateId })));
      }

      // El log registra que alguien votó, pero no qué boleta generó.
      await this.audit.log(em, electionId, 'VOTE_CAST', 'VOTER', { voterId: code.voterId });
      return { email: code.voter.email, title: code.voter.election.title };
    });

    // Fuera de la transacción: un correo fallido no anula un voto válido.
    await this.mail.sendConfirmation(result.email, result.title, receipt, now).catch(() => null);
    return { receipt, votedAt: now, electionTitle: result.title };
  }

  /** Verificación pública del recibo: confirma que la boleta existe y su estado, sin la selección. */
  async verifyReceipt(receipt: string) {
    const ballot = await this.ds.getRepository(Ballot).findOneBy({ receiptHash: sha256(receipt.trim()) });
    if (!ballot) return { found: false };
    return { found: true, status: ballot.status, castHour: ballot.castHour };
  }
}
