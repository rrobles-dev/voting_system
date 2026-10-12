/**
 * Modelo de datos con TypeORM. Si vienes de Spring: @Entity, @Column,
 * @ManyToOne y @OneToMany funcionan igual que en JPA/Hibernate.
 *
 * Regla de oro del sistema: Participation sabe QUIÉN votó; Ballot sabe QUÉ se votó.
 * Ninguna columna permite unir ambas tablas.
 */
import {
  Column, CreateDateColumn, Entity, Index, ManyToOne, OneToMany, OneToOne, JoinColumn,
  PrimaryGeneratedColumn, Unique,
} from 'typeorm';

export enum ElectionStatus {
  DRAFT = 'DRAFT',     // configurándose
  OPEN = 'OPEN',       // recibiendo votos
  CLOSED = 'CLOSED',   // cerrada, sin escrutinio publicado
  TALLIED = 'TALLIED', // escrutada
}
/** Qué hacer al abrir si hay votantes habilitados sin código activo. */
export enum CodesOnOpen {
  ISSUE = 'ISSUE', // emitirlos automáticamente justo antes del aviso de apertura
  BLOCK = 'BLOCK', // no abrir hasta que el admin los emita
}
export enum CodeStatus { ACTIVE = 'ACTIVE', USED = 'USED', INVALIDATED = 'INVALIDATED' }
export enum BallotStatus { VALID = 'VALID', ANNULLED = 'ANNULLED' }
export enum AnnulmentStatus { REQUESTED = 'REQUESTED', APPROVED = 'APPROVED', REJECTED = 'REJECTED' }

@Entity()
export class Election {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'enum', enum: ElectionStatus, default: ElectionStatus.DRAFT }) status: ElectionStatus;
  @Column({ type: 'timestamptz' }) opensAt: Date;
  @Column({ type: 'timestamptz' }) closesAt: Date;
  @Column({ default: 9 }) codeLength: number;
  @Column({ type: 'int', nullable: true }) quorumPercent: number | null; // null = sin quórum
  @Column({ default: 90 }) retentionDays: number;
  @Column({ default: true }) autoOpen: boolean; // abrir solo al llegar opensAt
  // Cierre automático en closesAt. Si es false, closesAt es referencial y la comisión cierra a mano.
  @Column({ default: true }) autoClose: boolean;
  @Column({ type: 'enum', enum: CodesOnOpen, default: CodesOnOpen.ISSUE }) codesOnOpen: CodesOnOpen;
  // Publicación posterior al escrutinio: acciones manuales, bloqueadas si hay empates pendientes
  @Column({ type: 'timestamptz', nullable: true }) membersNotifiedAt: Date | null;
  @Column({ default: false }) publicResults: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;

  @OneToMany(() => Position, (p) => p.election, { cascade: true }) positions: Position[];
}

@Entity()
export class Position {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() electionId: string;
  @ManyToOne(() => Election, (e) => e.positions, { onDelete: 'CASCADE' }) election: Election;
  @Column() name: string;
  @Column() seats: number;          // cupos a elegir
  @Column({ default: 0 }) minSelection: number;
  @Column() maxSelection: number;   // normalmente = seats
  @Column({ default: 0 }) sortOrder: number;
  @OneToMany(() => Candidate, (c) => c.position, { cascade: true }) candidates: Candidate[];
}

@Entity()
export class Candidate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() positionId: string;
  @ManyToOne(() => Position, (p) => p.candidates, { onDelete: 'CASCADE' }) position: Position;
  @Column() name: string;
  @Column({ type: 'text', nullable: true }) detail: string | null;
  @Column({ default: 0 }) sortOrder: number;
}

/** Padrón: lo provee el admin. El sistema solo lo procesa. */
@Entity()
@Unique(['electionId', 'externalRef'])
export class Voter {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() electionId: string;
  @ManyToOne(() => Election, { onDelete: 'CASCADE' }) election: Election;
  @Column() externalRef: string; // RUT de la empresa u otro identificador
  @Column() organization: string;
  @Column() email: string;
  @Column({ default: 1 }) weight: number;
  @Column({ default: true }) eligible: boolean;
  @OneToMany(() => Participation, (p) => p.voter) participations: Participation[];
}

@Entity()
export class AccessCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() voterId: string;
  @ManyToOne(() => Voter, { onDelete: 'CASCADE' }) voter: Voter;
  @Index({ unique: true }) @Column() codeHash: string; // HMAC del código; nunca en claro
  @Column({ type: 'enum', enum: CodeStatus, default: CodeStatus.ACTIVE }) status: CodeStatus;
  @CreateDateColumn({ type: 'timestamptz' }) issuedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) usedAt: Date | null;
}

/** QUIÉN votó y cuándo. Sin la selección. */
@Entity()
export class Participation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() electionId: string;
  @ManyToOne(() => Election, { onDelete: 'CASCADE' }) election: Election;
  @Column() voterId: string;
  @ManyToOne(() => Voter, (v) => v.participations, { onDelete: 'CASCADE' }) voter: Voter;
  @Column({ unique: true }) codeId: string;
  @OneToOne(() => AccessCode) @JoinColumn({ name: 'codeId' }) code: AccessCode;
  @Column({ type: 'timestamptz' }) votedAt: Date;
  @Column({ type: 'text', nullable: true }) ipEnc: string | null; // AES-256-GCM; solo el Auditor
  @Column({ type: 'text', nullable: true }) uaEnc: string | null;
  @Column({ default: false }) annulled: boolean;
}

/** QUÉ se votó. Sin referencia al votante. */
@Entity()
export class Ballot {
  @PrimaryGeneratedColumn('uuid') id: string; // uuid aleatorio: el orden no delata nada
  @Column() electionId: string;
  @ManyToOne(() => Election, { onDelete: 'CASCADE' }) election: Election;
  @Index({ unique: true }) @Column() receiptHash: string; // SHA-256 del recibo del votante
  @Column({ type: 'timestamptz' }) castHour: Date; // hora truncada: impide cruzar con votedAt
  @Column({ type: 'enum', enum: BallotStatus, default: BallotStatus.VALID }) status: BallotStatus;
  @OneToMany(() => BallotSelection, (s) => s.ballot, { cascade: true }) selections: BallotSelection[];
}

@Entity()
@Unique(['ballotId', 'candidateId'])
export class BallotSelection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() ballotId: string;
  @ManyToOne(() => Ballot, (b) => b.selections, { onDelete: 'CASCADE' }) ballot: Ballot;
  @Column() candidateId: string;
  @ManyToOne(() => Candidate) candidate: Candidate;
}

/** Control dual: lo solicita el Admin, lo aprueba el Auditor. */
@Entity()
export class Annulment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() electionId: string;
  @ManyToOne(() => Election, { onDelete: 'CASCADE' }) election: Election;
  @Column({ unique: true }) ballotId: string;
  @OneToOne(() => Ballot) @JoinColumn({ name: 'ballotId' }) ballot: Ballot;
  @Column() voterId: string; // quien declaró ser dueño del recibo
  @Column('text') reason: string;
  @Column({ type: 'enum', enum: AnnulmentStatus, default: AnnulmentStatus.REQUESTED }) status: AnnulmentStatus;
  @CreateDateColumn({ type: 'timestamptz' }) requestedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
}

export enum ActaKind {
  ESCRUTINIO = 'ESCRUTINIO',             // acta inicial, al publicar el escrutinio
  RESOLUCION_EMPATE = 'RESOLUCION_EMPATE', // acta complementaria con un empate resuelto fuera del sistema
}

/**
 * Acta oficial: copia congelada de los resultados con su hash.
 * Nunca se edita. Resolver un empate crea una versión nueva que referencia
 * el hash de la anterior (prevHash), igual que la cadena de auditoría.
 */
@Entity()
@Unique(['electionId', 'version'])
export class Acta {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() electionId: string;
  @ManyToOne(() => Election, { onDelete: 'CASCADE' }) election: Election;
  @Column() version: number;
  @Column({ type: 'enum', enum: ActaKind }) kind: ActaKind;
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
  @Column({ type: 'varchar', nullable: true }) prevHash: string | null;
  @Column() hash: string; // SHA-256 del snapshot canónico + prevHash
  @Column() pendingTies: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** Log encadenado: cada evento incluye el hash del anterior. */
@Entity()
export class AuditEvent {
  @PrimaryGeneratedColumn() seq: number;
  @Column({ type: 'uuid', nullable: true }) electionId: string | null;
  @Column() type: string;
  @Column() actor: string; // SYSTEM | ADMIN | AUDITOR | VOTER
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @Column() prevHash: string;
  @Column() hash: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ENTITIES = [
  Election, Position, Candidate, Voter, AccessCode, Participation, Ballot, BallotSelection, Annulment, Acta, AuditEvent,
];
