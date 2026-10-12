/**
 * Lógica pura de escrutinio, sin base de datos: así se testea aislada.
 * Recibe los votos por candidato y los cupos; devuelve electos y empates.
 */
export interface CandidateCount {
  candidateId: string;
  name: string;
  votes: number;
}

export interface PositionResult {
  ranking: (CandidateCount & { status: 'ELECTED' | 'TIED' | 'NOT_ELECTED' })[];
  tie: boolean; // hay empate en el último cupo → se resuelve fuera del sistema
}

export function tallyPosition(counts: CandidateCount[], seats: number): PositionResult {
  const sorted = [...counts].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  if (sorted.length <= seats) {
    return { ranking: sorted.map((c) => ({ ...c, status: 'ELECTED' as const })), tie: false };
  }

  // Votos del último cupo disponible y del primero que queda fuera.
  const cutoff = sorted[seats - 1].votes;
  const firstOut = sorted[seats].votes;
  const tie = cutoff === firstOut;

  const ranking = sorted.map((c) => {
    if (c.votes > cutoff) return { ...c, status: 'ELECTED' as const };
    if (c.votes === cutoff) return { ...c, status: tie ? ('TIED' as const) : ('ELECTED' as const) };
    return { ...c, status: 'NOT_ELECTED' as const };
  });
  return { ranking, tie };
}

/** Valida una selección contra las reglas del cargo. Devuelve el error o null. */
export function validateSelection(
  selected: string[],
  validCandidateIds: string[],
  minSelection: number,
  maxSelection: number,
): string | null {
  if (new Set(selected).size !== selected.length) return 'Hay candidatos repetidos';
  if (selected.some((id) => !validCandidateIds.includes(id))) return 'Candidato inválido para este cargo';
  if (selected.length < minSelection) return `Debes marcar al menos ${minSelection}`;
  if (selected.length > maxSelection) return `Puedes marcar como máximo ${maxSelection}`;
  return null;
}
