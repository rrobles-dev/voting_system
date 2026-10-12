import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Annulment, AnnulmentStatus, Ballot, BallotStatus, Election, ElectionStatus, Participation,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { VotersService } from '../voters/voters.service';
import { sha256 } from '../common/crypto';

/**
 * Anulación con control dual (four-eyes):
 *  1. El ADMIN la solicita con el recibo que entrega el votante + motivo.
 *  2. El AUDITOR la aprueba o rechaza. Nadie puede anular solo.
 * La boleta no se borra: queda ANULADA. El votante recibe un código nuevo.
 *
 * Ojo: el vínculo votante↔boleta lo establece el VOTANTE al entregar su recibo;
 * el sistema nunca lo tuvo guardado.
 */
@Injectable()
export class AnnulmentsService {
  constructor(private ds: DataSource, private audit: AuditService, private voters: VotersService) {}

  async request(electionId: string, voterId: string, receipt: string, reason: string) {
    const election = await this.ds.getRepository(Election).findOneBy({ id: electionId });
    if (!election) throw new NotFoundException('Elección no encontrada');
    if (election.status !== ElectionStatus.OPEN) throw new BadRequestException('Solo se anula con la votación abierta');

    const ballot = await this.ds.getRepository(Ballot).findOneBy({ receiptHash: sha256(receipt.trim()) });
    if (!ballot || ballot.electionId !== electionId) throw new NotFoundException('Recibo no encontrado');
    if (ballot.status !== BallotStatus.VALID) throw new BadRequestException('La boleta ya está anulada');
    const pending = await this.ds.getRepository(Annulment).findOneBy({ ballotId: ballot.id });
    if (pending) throw new BadRequestException('Ya existe una solicitud para esa boleta');

    const voted = await this.ds.getRepository(Participation).findOneBy({ electionId, voterId, annulled: false });
    if (!voted) throw new BadRequestException('Ese votante no tiene una participación vigente');

    return this.ds.transaction(async (em) => {
      const a = await em.save(Annulment, { electionId, ballotId: ballot.id, voterId, reason });
      await this.audit.log(em, electionId, 'ANNULMENT_REQUESTED', 'ADMIN', { annulmentId: a.id, voterId, reason });
      return a;
    });
  }

  list(electionId: string) {
    return this.ds.getRepository(Annulment).find({ where: { electionId }, order: { requestedAt: 'DESC' } });
  }

  async resolve(electionId: string, annulmentId: string, approve: boolean) {
    const a = await this.ds.getRepository(Annulment).findOneBy({ id: annulmentId });
    if (!a || a.electionId !== electionId) throw new NotFoundException('Solicitud no encontrada');
    if (a.status !== AnnulmentStatus.REQUESTED) throw new BadRequestException('La solicitud ya fue resuelta');

    await this.ds.transaction(async (em) => {
      await em.update(Annulment, { id: a.id }, {
        status: approve ? AnnulmentStatus.APPROVED : AnnulmentStatus.REJECTED,
        resolvedAt: new Date(),
      });
      if (approve) {
        await em.update(Ballot, { id: a.ballotId }, { status: BallotStatus.ANNULLED });
        await em.update(Participation, { electionId, voterId: a.voterId, annulled: false }, { annulled: true });
      }
      await this.audit.log(em, electionId, approve ? 'ANNULMENT_APPROVED' : 'ANNULMENT_REJECTED', 'AUDITOR', { annulmentId: a.id });
    });

    // Con la participación anulada, el votante vuelve a estar pendiente y recibe un código nuevo.
    if (approve) await this.voters.issueCodes(electionId, a.voterId);
    return { status: approve ? AnnulmentStatus.APPROVED : AnnulmentStatus.REJECTED };
  }
}
