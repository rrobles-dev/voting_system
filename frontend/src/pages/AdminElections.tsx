import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, auth } from '../api/client';
import type { Election } from '../api/types';

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador', OPEN: 'Abierta', CLOSED: 'Cerrada', TALLIED: 'Escrutada',
};

/** Ingreso al panel. v1: clave de API por rol. v2: Keycloak/JWT. */
export function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    auth.set(key);
    try {
      await api.get('/admin/elections', true);
      onLogin();
    } catch {
      auth.clear();
      setError('Clave inválida');
    }
  }
  return (
    <main className="admin narrow">
      <form className="card" onSubmit={submit}>
        <h1>Panel de la comisión</h1>
        <p className="lead">Ingresa tu clave de administrador o de auditor.</p>
        <label htmlFor="key">Clave</label>
        <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} required />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary">Ingresar</button>
      </form>
    </main>
  );
}

export function AdminElections() {
  const [elections, setElections] = useState<Election[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => { api.get<Election[]>('/admin/elections', true).then(setElections); }, []);

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Procesos de votación</h1>
        <button className="btn primary" onClick={() => setCreating((c) => !c)}>{creating ? 'Cancelar' : 'Nuevo proceso'}</button>
      </header>
      {creating && <CreateElection />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Proceso</th><th>Estado</th><th>Apertura</th><th>Cierre</th></tr></thead>
          <tbody>
            {elections.map((e) => (
              <tr key={e.id}>
                <td><Link to={`/admin/${e.id}`}>{e.title}</Link></td>
                <td><span className={`badge ${e.status}`}>{STATUS_LABEL[e.status]}</span></td>
                <td>{new Date(e.opensAt).toLocaleString('es-CL')}</td>
                <td>{new Date(e.closesAt).toLocaleString('es-CL')}</td>
              </tr>
            ))}
            {elections.length === 0 && <tr><td colSpan={4} className="muted">Aún no hay procesos.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

interface PositionDraft { name: string; seats: number; minSelection: number; maxSelection: number; candidates: string }

/** Formulario v1: lo esencial. v2: asistente con plantillas y validaciones cruzadas. */
function CreateElection() {
  const navigate = useNavigate();
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opensAt, setOpensAt] = useState(toLocal(new Date(Date.now() + 3600_000)));
  const [closesAt, setClosesAt] = useState(toLocal(new Date(Date.now() + 4 * 86400_000)));
  const [codeLength, setCodeLength] = useState(9);
  const [quorum, setQuorum] = useState('');
  const [positions, setPositions] = useState<PositionDraft[]>([
    { name: 'Directorio', seats: 5, minSelection: 1, maxSelection: 5, candidates: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<PositionDraft>) =>
    setPositions((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<Election>('/admin/elections', {
        title,
        description: description || undefined,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        codeLength,
        quorumPercent: quorum ? Number(quorum) : undefined,
        positions: positions.map((p) => ({
          name: p.name,
          seats: p.seats,
          minSelection: p.minSelection,
          maxSelection: p.maxSelection,
          // Un candidato por línea; "Nombre | detalle" opcional
          candidates: p.candidates.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [name, detail] = l.split('|').map((s) => s.trim());
            return { name, detail: detail || undefined };
          }),
        })),
      }, true);
      navigate(`/admin/${created.id}`);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <form className="card wide form-grid" onSubmit={submit}>
      <h2>Nuevo proceso</h2>
      <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label>Descripción (se muestra al votante)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></label>
      <div className="row">
        <label>Apertura<input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required /></label>
        <label>Cierre<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required /></label>
      </div>
      <div className="row">
        <label>Largo del código<input type="number" min={6} max={16} value={codeLength} onChange={(e) => setCodeLength(Number(e.target.value))} /></label>
        <label>Quórum % (opcional)<input type="number" min={1} max={100} value={quorum} onChange={(e) => setQuorum(e.target.value)} /></label>
      </div>
      {positions.map((p, i) => (
        <fieldset key={i} className="position-edit">
          <legend>Cargo {i + 1}</legend>
          <label>Nombre<input value={p.name} onChange={(e) => update(i, { name: e.target.value })} required /></label>
          <div className="row three">
            <label>Cupos<input type="number" min={1} value={p.seats} onChange={(e) => update(i, { seats: Number(e.target.value), maxSelection: Number(e.target.value) })} /></label>
            <label>Mín. marcas<input type="number" min={0} value={p.minSelection} onChange={(e) => update(i, { minSelection: Number(e.target.value) })} /></label>
            <label>Máx. marcas<input type="number" min={1} value={p.maxSelection} onChange={(e) => update(i, { maxSelection: Number(e.target.value) })} /></label>
          </div>
          <label>Candidatos (uno por línea, opcional "Nombre | Empresa")
            <textarea rows={5} value={p.candidates} onChange={(e) => update(i, { candidates: e.target.value })} required />
          </label>
          {positions.length > 1 && <button type="button" className="btn small" onClick={() => setPositions((ps) => ps.filter((_, j) => j !== i))}>Quitar cargo</button>}
        </fieldset>
      ))}
      <button type="button" className="btn" onClick={() => setPositions((ps) => [...ps, { name: '', seats: 1, minSelection: 0, maxSelection: 1, candidates: '' }])}>
        + Agregar cargo
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary">Crear proceso</button>
    </form>
  );
}
