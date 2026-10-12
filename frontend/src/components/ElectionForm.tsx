import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Election, ParsedCandidates, RollValidation } from '../api/types';
import { FileErrors, TemplateLinks } from './Templates';

/**
 * Formulario de proceso en dos pasos: completar → revisar → confirmar.
 * - Sin valores prellenados: cada dato importante lo decide la comisión explícitamente,
 *   para que nada quede configurado "por defecto" sin que nadie lo haya mirado.
 * - Sirve para crear y para editar (solo en borrador).
 * v2: plantillas de proceso ("Directorio", "Sí/No") que sí prellenen, pero elegidas a propósito.
 */
interface PositionDraft { name: string; seats: string; minSelection: string; maxSelection: string; candidates: string }
type Choice = '' | 'auto' | 'manual';

const emptyPosition = (): PositionDraft => ({ name: '', seats: '', minSelection: '', maxSelection: '', candidates: '' });
const toLines = (cands: { name: string; detail?: string | null }[]) => cands.map((c) => (c.detail ? `${c.name} | ${c.detail}` : c.name)).join('\n');
const parseLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, detail] = l.split('|').map((x) => x.trim());
  return { name, detail: detail || undefined };
});
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fmt = (local: string) => new Date(local).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' });

export function ElectionForm({ initial, onDone, onCancel }: {
  initial?: Election;               // si viene, es edición
  onDone: (id: string) => void;
  onCancel?: () => void;
}) {
  const editing = Boolean(initial);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [opensAt, setOpensAt] = useState(initial ? toLocal(initial.opensAt) : '');
  const [closesAt, setClosesAt] = useState(initial ? toLocal(initial.closesAt) : '');
  const [opening, setOpening] = useState<Choice>(initial ? (initial.autoOpen ? 'auto' : 'manual') : '');
  const [closing, setClosing] = useState<Choice>(initial ? (initial.autoClose ? 'auto' : 'manual') : '');
  const [refType, setRefType] = useState<'' | 'RUT' | 'CODE'>(initial?.refType ?? '');
  const [codesOnOpen, setCodesOnOpen] = useState<'' | 'ISSUE' | 'BLOCK'>(initial?.codesOnOpen ?? '');
  const [codeLength, setCodeLength] = useState(String(initial?.codeLength ?? 9));
  const [quorum, setQuorum] = useState(initial?.quorumPercent ? String(initial.quorumPercent) : '');
  const [positions, setPositions] = useState<PositionDraft[]>(
    initial?.positions?.length
      ? initial.positions.map((p) => ({
          name: p.name, seats: String(p.seats), minSelection: String(p.minSelection), maxSelection: String(p.maxSelection),
          candidates: toLines(p.candidates),
        }))
      : [emptyPosition()],
  );
  const [candidateMsg, setCandidateMsg] = useState<{ text: string; errors?: string[] } | null>(null);
  const [rollFile, setRollFile] = useState<File | null>(null);
  const [rollCheck, setRollCheck] = useState<RollValidation | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<PositionDraft>) =>
    setPositions((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function loadCandidates(file: File) {
    setCandidateMsg(null);
    try {
      const r = await api.postFile<ParsedCandidates>('/admin/templates/candidatos/parse', file);
      if (r.errors.length) { setCandidateMsg({ text: 'No se cargaron los candidatos.', errors: r.errors }); return; }
      setPositions((ps) => {
        // Si el único cargo está vacío, se reemplaza; si no, se completa por nombre
        const base = ps.length === 1 && !ps[0].name && !ps[0].candidates ? [] : [...ps];
        for (const g of r.positions) {
          const idx = base.findIndex((p) => p.name.trim().toLowerCase() === g.position.trim().toLowerCase());
          // Cupos y marcas quedan vacíos A PROPÓSITO: la comisión debe decidirlos
          if (idx >= 0) base[idx] = { ...base[idx], candidates: toLines(g.candidates) };
          else base.push({ ...emptyPosition(), name: g.position, candidates: toLines(g.candidates) });
        }
        return base;
      });
      const total = r.positions.reduce((n, g) => n + g.candidates.length, 0);
      setCandidateMsg({ text: `${total} candidato(s) cargados en ${r.positions.length} cargo(s). Completa cupos y marcas de cada cargo.` });
    } catch (e) {
      setCandidateMsg({ text: (e as ApiError).message });
    }
  }

  async function checkRoll(file: File, type = refType) {
    setRollFile(file);
    setRollCheck(null);
    if (!type) {
      setRollCheck({ total: 0, eligible: 0, notEligible: 0, errors: ['Primero elige el tipo de identificador (RUT u otro código) para validar el padrón'] });
      return;
    }
    try {
      setRollCheck(await api.postFile<RollValidation>('/admin/templates/padron/validate', file, { refType: type }));
    } catch (e) {
      setRollCheck({ total: 0, eligible: 0, notEligible: 0, errors: [(e as ApiError).message] });
    }
  }

  /** Validación antes de revisar: todos los problemas juntos, con el nombre del campo. */
  function validate(): string[] {
    const errs: string[] = [];
    if (!title.trim()) errs.push('Falta el título');
    if (!opensAt) errs.push('Falta la fecha de apertura');
    if (!closesAt) errs.push('Falta la fecha de cierre');
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) errs.push('El cierre debe ser posterior a la apertura');
    if (!opening) errs.push('Elige cómo se abre la votación (automática o manual)');
    if (!closing) errs.push('Elige cómo se cierra la votación (automática o manual)');
    if (!codesOnOpen) errs.push('Elige qué hacer si al abrir faltan códigos');
    if (!refType) errs.push('Elige el tipo de identificador de los votantes (RUT u otro código)');
    const cl = Number(codeLength);
    if (!Number.isInteger(cl) || cl < 6 || cl > 16) errs.push('El largo del código debe estar entre 6 y 16');
    if (quorum && (Number(quorum) < 1 || Number(quorum) > 100)) errs.push('El quórum debe estar entre 1 y 100');
    if (positions.length === 0) errs.push('Agrega al menos un cargo');
    const names = new Set<string>();
    positions.forEach((p, i) => {
      const label = p.name.trim() || `Cargo ${i + 1}`;
      const seats = Number(p.seats), min = Number(p.minSelection), max = Number(p.maxSelection);
      const cands = parseLines(p.candidates);
      if (!p.name.trim()) errs.push(`Cargo ${i + 1}: falta el nombre`);
      if (names.has(p.name.trim().toLowerCase())) errs.push(`${label}: nombre repetido`);
      names.add(p.name.trim().toLowerCase());
      if (!p.seats || seats < 1) errs.push(`${label}: indica los cupos (1 o más)`);
      if (p.minSelection === '' || min < 0) errs.push(`${label}: indica el mínimo de marcas (0 o más)`);
      if (!p.maxSelection || max < 1) errs.push(`${label}: indica el máximo de marcas (1 o más)`);
      if (p.minSelection !== '' && p.maxSelection && min > max) errs.push(`${label}: el mínimo no puede superar al máximo`);
      if (cands.length === 0) errs.push(`${label}: agrega candidatos`);
      if (max > cands.length) errs.push(`${label}: el máximo de marcas (${max}) supera a los candidatos (${cands.length})`);
      const lower = cands.map((c) => c.name.toLowerCase());
      if (new Set(lower).size !== lower.length) errs.push(`${label}: hay candidatos repetidos`);
    });
    if (rollCheck?.errors.length) errs.push('El padrón tiene errores: corrígelo o quítalo');
    return errs;
  }

  /** Avisos que no bloquean, pero que conviene mirar antes de confirmar. */
  function warnings(): string[] {
    const w: string[] = [];
    if (opensAt && new Date(opensAt) < new Date() && opening === 'auto') w.push('La fecha de apertura ya pasó: con apertura automática, el proceso se abrirá apenas tenga padrón.');
    if (closing === 'manual') w.push('Cierre manual: la fecha de cierre será referencial y se seguirán aceptando votos hasta que la comisión cierre. Los correos lo indicarán así.');
    positions.forEach((p) => {
      const seats = Number(p.seats), cands = parseLines(p.candidates).length;
      if (seats >= cands) w.push(`${p.name}: hay ${cands} candidato(s) para ${seats} cupo(s); todos quedarían electos.`);
      if (Number(p.maxSelection) > seats) w.push(`${p.name}: se permite marcar más candidatos (${p.maxSelection}) que cupos (${seats}).`);
    });
    if (!editing && !rollFile) w.push('Sin padrón: podrás cargarlo después, pero no se podrán emitir códigos ni abrir hasta hacerlo.');
    return w;
  }

  function review(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (!errs.length) { setStep('review'); window.scrollTo({ top: 0 }); }
  }

  async function confirm() {
    setBusy(true);
    setErrors([]);
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      opensAt: new Date(opensAt).toISOString(),
      closesAt: new Date(closesAt).toISOString(),
      autoOpen: opening === 'auto',
      autoClose: closing === 'auto',
      refType,
      codesOnOpen,
      codeLength: Number(codeLength),
      quorumPercent: quorum ? Number(quorum) : undefined,
      positions: positions.map((p) => ({
        name: p.name.trim(), seats: Number(p.seats), minSelection: Number(p.minSelection), maxSelection: Number(p.maxSelection),
        candidates: parseLines(p.candidates),
      })),
    };
    try {
      const saved = editing
        ? await api.put<Election>(`/admin/elections/${initial!.id}`, body)
        : await api.post<Election>('/admin/elections', body, true);
      if (rollFile) await api.postFile(`/admin/elections/${saved.id}/voters/import`, rollFile).catch(() => null);
      onDone(saved.id);
    } catch (err) {
      setErrors([(err as ApiError).message]);
      setStep('edit');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'review') {
    const warns = warnings();
    return (
      <section className="card wide form-grid" aria-labelledby="review-heading">
        <h2 id="review-heading">Revisa el proceso antes de {editing ? 'guardar los cambios' : 'crearlo'}</h2>
        <p className="help">Así lo verán la comisión y los votantes. Si algo no está bien, vuelve a editar.</p>
        <dl className="review-grid">
          <dt>Título</dt><dd>{title}</dd>
          {description && <><dt>Descripción</dt><dd>{description}</dd></>}
          <dt>Apertura</dt><dd>{fmt(opensAt)} · {opening === 'auto' ? 'automática' : 'manual'}</dd>
          <dt>Cierre</dt><dd>{fmt(closesAt)} · {closing === 'auto' ? 'automático' : 'manual (fecha referencial)'}</dd>
          <dt>Códigos al abrir</dt><dd>{codesOnOpen === 'ISSUE' ? 'Se emiten automáticamente los que falten' : 'No abre si faltan códigos'}</dd>
          <dt>Identificador</dt><dd>{refType === 'RUT' ? 'RUT chileno (se valida el dígito verificador)' : 'Código propio (se guarda tal cual)'}</dd>
          <dt>Código de votación</dt><dd>{codeLength} caracteres</dd>
          <dt>Quórum</dt><dd>{quorum ? `${quorum}%` : 'No se exige'}</dd>
          {!editing && <><dt>Padrón</dt><dd>{rollFile && rollCheck ? `${rollFile.name}: ${rollCheck.total} empresas, ${rollCheck.eligible} habilitadas` : 'Se cargará después'}</dd></>}
        </dl>
        {positions.map((p) => (
          <div key={p.name} className="review-position">
            <h3>{p.name}</h3>
            <p className="muted small">
              {p.seats} cupo(s) · cada votante marca {p.minSelection === p.maxSelection ? `exactamente ${p.maxSelection}` : `entre ${p.minSelection} y ${p.maxSelection}`}
            </p>
            <ol>{parseLines(p.candidates).map((c) => <li key={c.name}>{c.name}{c.detail && <span className="muted"> · {c.detail}</span>}</li>)}</ol>
          </div>
        ))}
        {warns.length > 0 && (
          <div className="notice warn"><strong>Revisa antes de confirmar:</strong><ul>{warns.map((w) => <li key={w}>{w}</li>)}</ul></div>
        )}
        {errors.length > 0 && <FileErrors errors={errors} title="No se pudo guardar:" />}
        <div className="actions">
          <button className="btn" onClick={() => setStep('edit')} disabled={busy}>Volver a editar</button>
          <button className="btn primary" onClick={confirm} disabled={busy}>
            {busy ? 'Guardando…' : editing ? 'Confirmar cambios' : 'Confirmar y crear proceso'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="card wide form-grid" onSubmit={review} noValidate>
      <h2>{editing ? 'Editar proceso' : 'Nuevo proceso'}</h2>
      {editing && <p className="notice">Solo se puede editar mientras el proceso está en borrador. Los códigos ya emitidos siguen siendo válidos.</p>}
      <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Descripción (se muestra al votante)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></label>

      <fieldset className="position-edit">
        <legend>Período</legend>
        <div className="row">
          <label>Apertura<input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></label>
          <label>Cierre<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
        </div>
        <div className="row">
          <div role="radiogroup" aria-label="Modo de apertura" className="choice">
            <span className="choice-label">¿Cómo se abre?</span>
            <label className="radio"><input type="radio" name="opening" checked={opening === 'auto'} onChange={() => setOpening('auto')} /> Automática, en la fecha de apertura</label>
            <label className="radio"><input type="radio" name="opening" checked={opening === 'manual'} onChange={() => setOpening('manual')} /> Manual, con el botón "Abrir ahora"</label>
          </div>
          <div role="radiogroup" aria-label="Modo de cierre" className="choice">
            <span className="choice-label">¿Cómo se cierra?</span>
            <label className="radio"><input type="radio" name="closing" checked={closing === 'auto'} onChange={() => setClosing('auto')} /> Automático, en la fecha de cierre</label>
            <label className="radio"><input type="radio" name="closing" checked={closing === 'manual'} onChange={() => setClosing('manual')} /> Manual (la fecha queda como referencia)</label>
          </div>
        </div>
        <label>Si al abrir hay votantes habilitados sin código
          <select value={codesOnOpen} onChange={(e) => setCodesOnOpen(e.target.value as 'ISSUE' | 'BLOCK')}>
            <option value="" disabled>Selecciona una opción…</option>
            <option value="ISSUE">Emitirlos y enviarlos automáticamente antes de abrir</option>
            <option value="BLOCK">No abrir hasta que la comisión los emita</option>
          </select>
        </label>
      </fieldset>

      <div className="row">
        <label>Largo del código<input type="number" min={6} max={16} value={codeLength} onChange={(e) => setCodeLength(e.target.value)} /></label>
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
          <label>Nombre<input value={p.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Ej.: Directorio" /></label>
          <div className="row three">
            <label>Cupos<input type="number" min={1} value={p.seats} onChange={(e) => update(i, { seats: e.target.value })} /></label>
            <label>Mín. marcas<input type="number" min={0} value={p.minSelection} onChange={(e) => update(i, { minSelection: e.target.value })} /></label>
            <label>Máx. marcas<input type="number" min={1} value={p.maxSelection} onChange={(e) => update(i, { maxSelection: e.target.value })} /></label>
          </div>
          <label>Candidatos (uno por línea, opcional "Nombre | Empresa")
            <textarea rows={5} value={p.candidates} onChange={(e) => update(i, { candidates: e.target.value })} />
          </label>
          {positions.length > 1 && <button type="button" className="btn small" onClick={() => setPositions((ps) => ps.filter((_, j) => j !== i))}>Quitar cargo</button>}
        </fieldset>
      ))}
      <button type="button" className="btn" onClick={() => setPositions((ps) => [...ps, emptyPosition()])}>+ Agregar cargo</button>

      <fieldset className="position-edit">
        <legend>Identificador de los votantes</legend>
        <div role="radiogroup" aria-label="Tipo de identificador" className="choice">
          <label className="radio"><input type="radio" name="refType" checked={refType === 'RUT'}
            onChange={() => { setRefType('RUT'); if (rollFile) checkRoll(rollFile, 'RUT'); }} /> RUT chileno (con o sin puntos; se valida el dígito verificador)</label>
          <label className="radio"><input type="radio" name="refType" checked={refType === 'CODE'}
            onChange={() => { setRefType('CODE'); if (rollFile) checkRoll(rollFile, 'CODE'); }} /> Otro código: número de socio, código interno, etc. (se guarda tal cual)</label>
        </div>
        <p className="help">Sirve para detectar votantes duplicados. El correo también debe ser único en el padrón.</p>
      </fieldset>

      {!editing && (
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
      )}

      {errors.length > 0 && <div role="alert"><FileErrors errors={errors} title={`Falta completar o corregir ${errors.length} punto(s):`} /></div>}
      <div className="actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
        <button className="btn primary">Revisar antes de {editing ? 'guardar' : 'crear'}</button>
      </div>
    </form>
  );
}
