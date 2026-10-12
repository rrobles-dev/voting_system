import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, auth } from '../api/client';
import type { Election, ParsedCandidates, RollValidation } from '../api/types';
import { FileErrors, TemplateLinks } from '../components/Templates';

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

const toLines = (cands: { name: string; detail?: string }[]) => cands.map((c) => (c.detail ? `${c.name} | ${c.detail}` : c.name)).join('\n');

/**
 * Formulario v1: lo esencial, con carga opcional de candidatos y padrón desde plantilla.
 * Los archivos se validan ANTES de crear el proceso: los errores aparecen todos juntos.
 * v2: asistente por pasos con plantillas de proceso.
 */
function CreateElection() {
  const navigate = useNavigate();
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opensAt, setOpensAt] = useState(toLocal(new Date(Date.now() + 3600_000)));
  const [closesAt, setClosesAt] = useState(toLocal(new Date(Date.now() + 4 * 86400_000)));
  const [autoOpen, setAutoOpen] = useState(true);
  const [codesOnOpen, setCodesOnOpen] = useState<'ISSUE' | 'BLOCK'>('ISSUE');
  const [codeLength, setCodeLength] = useState(9);
  const [quorum, setQuorum] = useState('');
  const [positions, setPositions] = useState<PositionDraft[]>([
    { name: 'Directorio', seats: 5, minSelection: 1, maxSelection: 5, candidates: '' },
  ]);
  const [candidateMsg, setCandidateMsg] = useState<{ text: string; errors?: string[] } | null>(null);
  const [rollFile, setRollFile] = useState<File | null>(null);
  const [rollCheck, setRollCheck] = useState<RollValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<PositionDraft>) =>
    setPositions((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  /** Los candidatos del archivo rellenan los cargos (por nombre); los cargos nuevos se agregan con 1 cupo. */
  async function loadCandidates(file: File) {
    setCandidateMsg(null);
    try {
      const r = await api.postFile<ParsedCandidates>('/admin/templates/candidatos/parse', file);
      if (r.errors.length) { setCandidateMsg({ text: 'No se cargaron los candidatos.', errors: r.errors }); return; }
      setPositions((ps) => {
        const next = [...ps];
        for (const group of r.positions) {
          const idx = next.findIndex((p) => p.name.trim().toLowerCase() === group.position.trim().toLowerCase());
          if (idx >= 0) next[idx] = { ...next[idx], candidates: toLines(group.candidates) };
          else next.push({ name: group.position, seats: 1, minSelection: 0, maxSelection: 1, candidates: toLines(group.candidates) });
        }
        return next;
      });
      const total = r.positions.reduce((n, g) => n + g.candidates.length, 0);
      setCandidateMsg({ text: `${total} candidato(s) cargados en ${r.positions.length} cargo(s). Revisa cupos y marcas de cada cargo.` });
    } catch (e) {
      setCandidateMsg({ text: (e as ApiError).message });
    }
  }

  async function checkRoll(file: File) {
    setRollFile(file);
    setRollCheck(null);
    try {
      setRollCheck(await api.postFile<RollValidation>('/admin/templates/padron/validate', file));
    } catch (e) {
      setRollCheck({ total: 0, eligible: 0, notEligible: 0, errors: [(e as ApiError).message] });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (rollCheck?.errors.length) { setError('Corrige el padrón o quítalo antes de crear el proceso.'); return; }
    setBusy(true);
    try {
      const created = await api.post<Election>('/admin/elections', {
        title,
        description: description || undefined,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        autoOpen,
        codesOnOpen,
        codeLength,
        quorumPercent: quorum ? Number(quorum) : undefined,
        positions: positions.map((p) => ({
          name: p.name,
          seats: p.seats,
          minSelection: p.minSelection,
          maxSelection: p.maxSelection,
          // Un candidato por línea; "Nombre | detalle" opcional
          candidates: p.candidates.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [name, detail] = l.split('|').map((x) => x.trim());
            return { name, detail: detail || undefined };
          }),
        })),
      }, true);
      // El padrón ya fue validado; si aun así falla, el proceso queda en borrador y se reintenta desde su página.
      if (rollFile) await api.postFile(`/admin/elections/${created.id}/voters/import`, rollFile).catch(() => null);
      navigate(`/admin/${created.id}`);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card wide form-grid" onSubmit={submit}>
      <h2>Nuevo proceso</h2>
      <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label>Descripción (se muestra al votante)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></label>

      <fieldset className="position-edit">
        <legend>Período y apertura</legend>
        <div className="row">
          <label>Apertura<input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required /></label>
          <label>Cierre<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required /></label>
        </div>
        <label className="switch">
          <input type="checkbox" checked={autoOpen} onChange={(e) => setAutoOpen(e.target.checked)} />
          Abrir automáticamente en la fecha de apertura
        </label>
        <p className="help">{autoOpen ? 'El sistema abrirá la votación solo, a la hora indicada.' : 'La votación se abrirá cuando alguien pulse "Abrir ahora".'} El cierre siempre es automático.</p>
        <label>Si al abrir hay votantes habilitados sin código
          <select value={codesOnOpen} onChange={(e) => setCodesOnOpen(e.target.value as 'ISSUE' | 'BLOCK')}>
            <option value="ISSUE">Emitirlos y enviarlos automáticamente antes de abrir</option>
            <option value="BLOCK">No abrir hasta que la comisión los emita</option>
          </select>
        </label>
      </fieldset>

      <div className="row">
        <label>Largo del código<input type="number" min={6} max={16} value={codeLength} onChange={(e) => setCodeLength(Number(e.target.value))} /></label>
        <label>Quórum % (opcional)<input type="number" min={1} max={100} value={quorum} onChange={(e) => setQuorum(e.target.value)} /></label>
      </div>

      <fieldset className="position-edit">
        <legend>Candidatos desde archivo (opcional)</legend>
        <TemplateLinks kind="candidatos" />
        <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Archivo de candidatos"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadCandidates(f); }} />
        {candidateMsg && (candidateMsg.errors ? <FileErrors errors={candidateMsg.errors} /> : <p className="notice ok">{candidateMsg.text}</p>)}
      </fieldset>

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

      <fieldset className="position-edit">
        <legend>Padrón (opcional, también puedes cargarlo después)</legend>
        <TemplateLinks kind="padron" />
        <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Archivo de padrón"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) checkRoll(f); }} />
        {rollFile && rollCheck && !rollCheck.errors.length && (
          <p className="notice ok">{rollFile.name}: {rollCheck.total} empresas, {rollCheck.eligible} habilitadas{rollCheck.notEligible ? `, ${rollCheck.notEligible} bloqueadas` : ''}. Se cargará al crear el proceso.</p>
        )}
        <FileErrors errors={rollCheck?.errors} />
        {rollFile && <button type="button" className="btn small" onClick={() => { setRollFile(null); setRollCheck(null); }}>Quitar padrón</button>}
      </fieldset>

      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear proceso'}</button>
    </form>
  );
}
