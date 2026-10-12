import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PublicResults as Data } from '../api/types';

/**
 * Página pública e insertable (iframe) con el acta oficial definitiva.
 * Sin navegación ni marca propia: hereda el contexto de la web donde se inserta.
 * Solo existe si el admin la habilitó y no hay empates pendientes.
 */
export function PublicResults() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/public/elections/${id}/results`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [id]);

  if (error) return <main className="public"><p className="muted">Los resultados de este proceso aún no están publicados.</p></main>;
  if (!data) return <main className="public"><p className="muted">Cargando…</p></main>;

  return (
    <main className="public">
      <p className="eyebrow">Resultados oficiales</p>
      <h1>{data.title}</h1>
      <p className="muted small">
        Participación: {data.participation.voted} de {data.participation.eligible} ({data.participation.percent}%) ·
        Acta oficial v{data.actaVersion} del {new Date(data.issuedAt).toLocaleDateString('es-CL', { dateStyle: 'long' })}
      </p>
      {data.positions.map((p) => (
        <section key={p.name} className="public-position">
          <h2>{p.name}</h2>
          <ol className="elected">
            {p.elected.map((c) => (
              <li key={c.name}><span>{c.name}</span><span className="votes">{c.votes} {c.votes === 1 ? "voto" : "votos"}</span></li>
            ))}
          </ol>
          {p.others.length > 0 && (
            <details>
              <summary>Otros candidatos</summary>
              <ul className="others">
                {p.others.map((c) => <li key={c.name}><span>{c.name}</span><span className="votes">{c.votes} {c.votes === 1 ? "voto" : "votos"}</span></li>)}
              </ul>
            </details>
          )}
          {p.resolutionNote && <p className="muted small">Cupo asignado por resolución de empate: {p.resolutionNote}</p>}
        </section>
      ))}
      <p className="hash-line" title={data.actaHash}>Huella del acta: <code>{data.actaHash.slice(0, 16)}…</code></p>
    </main>
  );
}
