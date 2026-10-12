export interface Candidate { id: string; name: string; detail: string | null }
export interface Position {
  id: string; name: string; seats: number; minSelection: number; maxSelection: number; candidates: Candidate[];
}
export interface BallotSession {
  organization: string;
  election: { id: string; title: string; description: string | null; closesAt: string; positions: Position[] };
}
export interface CastResult { receipt: string; votedAt: string; electionTitle: string }

export type ElectionStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'TALLIED';
export interface Election {
  id: string; title: string; description: string | null; status: ElectionStatus;
  opensAt: string; closesAt: string; codeLength: number; quorumPercent: number | null; positions?: Position[];
  refType: 'RUT' | 'CODE'; autoOpen: boolean; autoClose: boolean; codesOnOpen: 'ISSUE' | 'BLOCK';
}
export interface ParticipationReport {
  status: ElectionStatus; eligible: number; voted: number; percent: number;
  quorumPercent: number | null; quorumReached: boolean | null;
  voters: { id: string; ref: string; organization: string; email: string; eligible: boolean; votedAt: string | null }[];
}
export interface Results {
  source: 'PRELIMINARY' | 'ACTA';
  acta?: { version: number; kind: 'ESCRUTINIO' | 'RESOLUCION_EMPATE'; hash: string; pendingTies: boolean; createdAt: string };
  publication?: { membersNotifiedAt: string | null; publicResults: boolean };
  validBallots: number; annulledBallots: number;
  positions: {
    id: string; name: string; seats: number; tie: boolean;
    ranking: { candidateId: string; name: string; votes: number; status: 'ELECTED' | 'TIED' | 'NOT_ELECTED'; byResolution?: boolean }[];
    resolution?: { winners: string[]; note: string; resolvedAt: string };
  }[];
}
export interface ActaVerification {
  chainOk: boolean; brokenAtVersion?: number; recountMatches: boolean | null;
  differences: { position: string; candidate: string; acta: number; recount: number }[];
}
export interface PublicResults {
  title: string; closedAt: string; actaVersion: number; actaHash: string; issuedAt: string;
  participation: { eligible: number; voted: number; percent: number };
  positions: { name: string; seats: number; elected: { name: string; votes: number }[]; others: { name: string; votes: number }[]; resolutionNote: string | null }[];
}
export interface AuditEvent { seq: number; type: string; actor: string; payload: Record<string, unknown>; createdAt: string; hash: string }
export interface Annulment { id: string; voterId: string; reason: string; status: 'REQUESTED' | 'APPROVED' | 'REJECTED'; requestedAt: string }
export interface RollValidation { total: number; eligible: number; notEligible: number; errors: string[]; warnings?: string[] }
export interface ParsedCandidates { positions: { position: string; candidates: { name: string; detail?: string }[] }[]; errors: string[] }
export interface IssueResult { issued: number; emailed: number; voters: { organization: string; emailed: boolean; code?: string }[] }
