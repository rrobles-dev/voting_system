import { tallyPosition, validateSelection } from '../src/results/tally';

const c = (name: string, votes: number) => ({ candidateId: name, name, votes });

describe('tallyPosition', () => {
  it('elige a los N más votados', () => {
    const r = tallyPosition([c('A', 10), c('B', 8), c('C', 5), c('D', 2)], 2);
    expect(r.tie).toBe(false);
    expect(r.ranking.map((x) => [x.name, x.status])).toEqual([
      ['A', 'ELECTED'], ['B', 'ELECTED'], ['C', 'NOT_ELECTED'], ['D', 'NOT_ELECTED'],
    ]);
  });

  it('marca empate en el último cupo sin resolverlo', () => {
    const r = tallyPosition([c('A', 10), c('B', 6), c('C', 6), c('D', 2)], 2);
    expect(r.tie).toBe(true);
    expect(r.ranking.find((x) => x.name === 'A')!.status).toBe('ELECTED');
    expect(r.ranking.filter((x) => x.status === 'TIED').map((x) => x.name)).toEqual(['B', 'C']);
    expect(r.ranking.find((x) => x.name === 'D')!.status).toBe('NOT_ELECTED');
  });

  it('un empate que no toca el corte no es empate', () => {
    const r = tallyPosition([c('A', 10), c('B', 10), c('C', 3)], 2);
    expect(r.tie).toBe(false);
    expect(r.ranking.filter((x) => x.status === 'ELECTED')).toHaveLength(2);
  });

  it('con menos candidatos que cupos, todos electos', () => {
    expect(tallyPosition([c('A', 0)], 3).ranking[0].status).toBe('ELECTED');
  });
});

describe('validateSelection', () => {
  const valid = ['a', 'b', 'c', 'd'];
  it('acepta selección dentro de rango', () => expect(validateSelection(['a', 'b'], valid, 1, 3)).toBeNull());
  it('rechaza exceso', () => expect(validateSelection(['a', 'b', 'c', 'd'], valid, 1, 3)).toMatch(/máximo/));
  it('rechaza bajo el mínimo', () => expect(validateSelection([], valid, 1, 3)).toMatch(/al menos/));
  it('rechaza repetidos', () => expect(validateSelection(['a', 'a'], valid, 1, 3)).toMatch(/repetidos/));
  it('rechaza candidato ajeno', () => expect(validateSelection(['z'], valid, 1, 3)).toMatch(/inválido/));
});
