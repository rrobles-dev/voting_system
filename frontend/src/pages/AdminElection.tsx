import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../api/client';
import type { ActaVerification, Annulment, AuditEvent, Election, IssueResult, ParticipationReport, Results } from '../api/types';
import { FileErrors, TemplateLinks } from '../components/Templates';
import { ElectionForm } from '../components/ElectionForm';
import { useConfirm } from '../components/Confirm';
import { STATUS_LABEL } from './AdminElections';

type Tab = 'participacion' | 'consola' | 'resultados' | 'padron' | 'anulaciones';

const EVENT_LABEL: Record<string, string> = {
  ELECTION_CREATED: 'Proceso creado', ELECTION_UPDATED: 'Proceso editado', VOTER_ADDED: 'Votante agregado',
  VOTER_ENABLED: 'Votante habilitado', VOTER_DISABLED: 'Votante bloqueado', VOTER_REMOVED: 'Votante quitado del padrón', AUTO_OPEN_BLOCKED: 'Apertura automática bloqueada', ROLL_IMPORTED: 'Padrón importado', CODE_ISSUED: 'Código emitido',
  CODE_REISSUED: 'Código reemitido', ELECTION_OPEN: 'Votación abierta', ELECTION_CLOSED: 'Votación cerrada',
  ELECTION_TALLIED: 'Escrutinio publicado', ACTA_ISSUED: 'Acta oficial emitida', TIE_RESOLVED: 'Empate resuelto (acta complementaria)',
  MEMBERS_NOTIFIED: 'Resultados notificados a los socios', PUBLIC_RESULTS_ENABLED: 'Resultados públicos habilitados',
  PUBLIC_RESULTS_DISABLED: 'Resultados públicos deshabilitados', VOTE_CAST: 'Voto recibido', REMINDERS_SENT: 'Recordatorios enviados',
  ANNULMENT_REQUESTED: 'Anulación solicitada', ANNULMENT_APPROVED: 'Anulación aprobada',
  ANNULMENT_REJECTED: 'Anulación rechazada', AUDIT_REPORT_ACCESSED: 'Reporte de auditoría consultado',
};

export function AdminElection() {
  const { id } = useParams<{ id: string }>();
  const [election, setElection] = useState<Election | null>(null);
  const [tab, setTab] = useState<Tab>('participacion');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [issuedCodes, setIssuedCodes] = useState<{ organization: string; code?: string }[]>([]);
  const [roll, setRoll] = useState<{ total: number; eligible: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [ask, confirmUi] = useConfirm();

  const load = useCallback(() => {
    api.get<Election>(`/admin/elections/${id}`, true).then(setElection);
    api.get<ParticipationReport>(`/admin/elections/${id}/participation`, true)
      .then((p) => setRoll({ total: p.voters.length, eligible: p.eligible }))
      .catch(() => null);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  /**
   * El mensaje de éxito se arma con lo que la API REALMENTE hizo (cuántos códigos, cuántos correos),
   * nunca con un texto fijo: un "enviado" que no ocurrió es peor que un error.
   */
  async function action<T>(path: string, describe: (r: T) => { kind: 'ok' | 'error'; text: string }, after?: (r: T) => void) {
    setFlash(null);
    try {
      const r = await api.post<T>(`/admin/elections/${id}${path}`, {}, true);
      setFlash(describe(r));
      after?.(r);
      load();
    } catch (err) {
      setFlash({ kind: 'error', text: (err as ApiError).message });
    }
  }

  if (!election) return <main className="admin"><p>Cargando…</p></main>;
  const closed = election.status === 'CLOSED' || election.status === 'TALLIED';

  if (editing) {
    return (
      <main className="admin">
        <ElectionForm initial={election} onCancel={() => setEditing(false)}
          onDone={() => { setEditing(false); setFlash({ kind: 'ok', text: 'Cambios guardados y registrados en la consola' }); load(); }} />
      </main>
    );
  }

  return (
    <main className="admin">
      <Link to="/admin" className="link">← Procesos</Link>
      <header className="admin-head">
        <div>
          <h1>{election.title}</h1>
          <p className="muted">
            <span className={`badge ${election.status}`}>{STATUS_LABEL[election.status]}</span>{' '}
            {new Date(election.opensAt).toLocaleString('es-CL')} → {new Date(election.closesAt).toLocaleString('es-CL')}
          </p>
          {['DRAFT', 'OPEN'].includes(election.status) && (
            <p className="muted small">
              {election.status === 'DRAFT' && <>{election.autoOpen ? 'Apertura automática' : 'Apertura manual'} · </>}
              {election.autoClose ? 'Cierre automático' : 'Cierre manual (la fecha de cierre es referencial)'} ·{' '}
              {election.refType === 'RUT' ? 'identificador: RUT' : 'identificador: código propio'} ·{' '}
              {election.status === 'DRAFT' && <>{election.codesOnOpen === 'ISSUE' ? 'los códigos faltantes se emiten al abrir' : 'no abre si faltan códigos'} · </>}
              {roll ? (roll.total ? `${roll.total} en el padrón (${roll.eligible} habilitados)` : 'sin padrón cargado') : ''}
            </p>
          )}
        </div>
        <div className="toolbar">
          {election.status === 'DRAFT' && <button className="btn" onClick={() => setEditing(true)}>Editar proceso</button>}
          {['DRAFT', 'OPEN'].includes(election.status) && (
            <button className="btn" disabled={!roll?.eligible} title={!roll?.total ? 'Carga el padrón primero' : undefined}
              onClick={async () => (election.status === 'DRAFT' || await ask({
                title: '¿Reenviar códigos a todos los pendientes?',
                detail: 'Se generará un código NUEVO para cada votante que aún no votó y se le enviará por correo. Los códigos anteriores dejarán de funcionar: el sistema no guarda los códigos, solo su huella, así que no puede reenviar los mismos.',
                cta: 'Reenviar códigos',
              })) && action<IssueResult>('/codes/issue', (r) => r.emailed === r.issued
                ? { kind: 'ok', text: `Se emitieron ${r.issued} código(s) y se enviaron por correo.` }
                : { kind: 'error', text: `Se emitieron ${r.issued} código(s), pero solo ${r.emailed} correo(s) se enviaron. Revisa el servidor de correo y reemite los que faltan desde Participación.` },
                (r) => setIssuedCodes(r.voters))}>
              {election.status === 'OPEN' ? 'Reenviar códigos a pendientes' : 'Emitir códigos'}
            </button>
          )}
          {election.status === 'DRAFT' && (
            <button className="btn primary" disabled={!roll?.eligible}
              onClick={async () => (await ask({
                title: '¿Abrir la votación ahora?',
                detail: election.codesOnOpen === 'ISSUE' ? 'Los votantes habilitados que aún no tienen código lo recibirán automáticamente antes del aviso de apertura.' : undefined,
                cta: 'Abrir votación',
              })) && action('/open', () => ({ kind: 'ok', text: 'Votación abierta' }))}>
              Abrir ahora
            </button>
          )}
          {election.status === 'OPEN' && (
            <>
              <button className="btn" onClick={() => action<{ sent: number; pending: number }>('/reminders', (r) => r.sent === r.pending
                ? { kind: 'ok', text: `Recordatorio enviado a ${r.sent} votante(s) pendiente(s).` }
                : { kind: 'error', text: `Recordatorio enviado a ${r.sent} de ${r.pending} pendientes. Algunos correos fallaron.` })}>
                Enviar recordatorios
              </button>
              <button className="btn danger" onClick={async () => (await ask({ title: '¿Cerrar la votación ahora?', detail: 'No se puede reabrir. Quienes no hayan votado ya no podrán hacerlo.', cta: 'Cerrar votación', danger: true })) && action('/close', () => ({ kind: 'ok', text: 'Votación cerrada' }))}>Cerrar ahora</button>
            </>
          )}
          {election.status === 'CLOSED' && <button className="btn primary" onClick={() => action<{ pendingTies: boolean }>('/tally', (r) => ({ kind: 'ok', text: r.pendingTies ? 'Acta oficial v1 emitida con empate pendiente de resolución' : 'Acta oficial v1 emitida' }), () => setTab('resultados'))}>Publicar escrutinio</button>}
        </div>
      </header>
      {confirmUi}
      {flash && <p className={`notice ${flash.kind === 'ok' ? 'ok' : 'warn'}`} role="status">{flash.text}</p>}

      {issuedCodes.some((c) => c.code) && (
        <details className="card dev" open>
          <summary>Códigos emitidos (visibles solo en modo desarrollo)</summary>
          <ul className="codes">{issuedCodes.map((c) => <li key={c.organization}><span>{c.organization}</span><code>{c.code}</code></li>)}</ul>
        </details>
      )}

      <nav className="tabs" role="tablist">
        {([
          ['participacion', 'Participación'], ['consola', 'Consola'], ['resultados', 'Resultados'],
          ['padron', 'Padrón y reportes'], ['anulaciones', 'Anulaciones'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </nav>

      {tab === 'participacion' && <ParticipationTab id={id!} onChange={(text, kind = 'ok') => { setFlash({ kind, text }); load(); }} />}
      {tab === 'consola' && <ConsoleTab id={id!} />}
      {tab === 'resultados' && (closed ? <ResultsTab key={election.status} id={id!} /> : (
        <p className="notice">Los resultados se habilitan al cierre. Durante la votación el sistema no permite consultar conteos ni tendencias.</p>
      ))}
      {tab === 'padron' && <RollTab election={election} onDone={load} />}
      {tab === 'anulaciones' && <AnnulmentsTab id={id!} open={election.status === 'OPEN'} />}
    </main>
  );
}

/**
 * Participación con refresco automático. Muestra QUIÉN votó, nunca QUÉ.
 * Permite cambios puntuales al padrón (agregar, habilitar, bloquear); con la votación
 * abierta cada cambio exige un motivo que queda en la consola.
 */
function ParticipationTab({ id, onChange }: { id: string; onChange: (text: string, kind?: 'ok' | 'error') => void }) {
  const [data, setData] = useState<ParticipationReport | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'voted' | 'blocked'>('all');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const load = useCallback(() => api.get<ParticipationReport>(`/admin/elections/${id}/participation`, true).then(setData).catch(() => null), [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // polling cada 10 s
    return () => clearInterval(t);
  }, [load]);
  if (!data) return <p>Cargando…</p>;

  const open = data.status === 'OPEN';
  const editable = data.status === 'DRAFT' || open;
  const rows = data.voters.filter((v) =>
    filter === 'all' || (filter === 'voted' ? v.votedAt : filter === 'blocked' ? !v.eligible : v.eligible && !v.votedAt));

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); onChange(ok); await load(); } catch (e) { onChange((e as ApiError).message, 'error'); }
  }

  /**
   * Acciones sobre un votante: se confirman en un panel dentro de la página, nunca con
   * prompt()/confirm() del navegador (algunos navegadores integrados, como el de VS Code,
   * los cancelan en silencio y el botón "no hace nada").
   */
  async function execute(a: PendingAction, reason: string) {
    const base = `/admin/elections/${id}/voters/${a.voter.id}`;
    const r = reason || undefined;
    if (a.kind === 'reissue') return run(() => api.post(`${base}/reissue`, {}, true), `Código nuevo enviado a ${a.voter.organization}`);
    if (a.kind === 'remove') return run(() => api.post(`${base}/remove`, { reason: r }, true), `${a.voter.organization} quitada del padrón`);
    const eligible = a.kind === 'enable';
    return run(
      () => api.patch(`${base}/eligibility`, { eligible, reason: r }),
      eligible ? `${a.voter.organization} habilitada${open ? '; se le envió su código' : ''}` : `${a.voter.organization} bloqueada; su código dejó de funcionar`,
    );
  }

  return (
    <section>
      <div className="stats">
        <div className="stat"><span className="stat-value">{data.voted}</span><span className="stat-label">votaron</span></div>
        <div className="stat"><span className="stat-value">{data.eligible - data.voted}</span><span className="stat-label">pendientes</span></div>
        <div className="stat"><span className="stat-value">{data.percent}%</span><span className="stat-label">participación</span></div>
        {data.quorumPercent != null && (
          <div className="stat"><span className="stat-value">{data.quorumReached ? 'Sí' : 'No'}</span><span className="stat-label">quórum ({data.quorumPercent}%)</span></div>
        )}
      </div>
      <div className="progress" role="progressbar" aria-valuenow={data.percent} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${data.percent}%` }} />
        {data.quorumPercent != null && <span className="quorum-mark" style={{ left: `${data.quorumPercent}%` }} />}
      </div>
      <div className="filters">
        {(['all', 'pending', 'voted', 'blocked'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {{ all: 'Todos', pending: 'Pendientes', voted: 'Votaron', blocked: 'Bloqueados' }[f]}
          </button>
        ))}
        {editable && <button className="btn small" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancelar' : '+ Agregar votante'}</button>}
      </div>
      {adding && <AddVoter id={id} open={open} onDone={(msg) => { setAdding(false); run(async () => undefined, msg); }} />}
      {pending && (
        <ConfirmAction action={pending} needsReason={open && pending.kind !== 'reissue'}
          onCancel={() => setPending(null)} onConfirm={async (reason) => { await execute(pending, reason); setPending(null); }} />
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Empresa</th><th>Correo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>{v.organization}<div className="muted small">{v.ref}</div></td>
                <td>{v.email}</td>
                <td>{!v.eligible ? <span className="badge muted">Bloqueada</span> : v.votedAt ? <span className="badge OPEN">Votó {new Date(v.votedAt).toLocaleString('es-CL')}</span> : <span className="badge DRAFT">Pendiente</span>}</td>
                <td className="row-actions">
                  {editable && v.eligible && !v.votedAt && <button className="btn small" onClick={() => setPending({ kind: 'reissue', voter: v })}>Reemitir código</button>}
                  {editable && !v.votedAt && (
                    <button className="btn small" onClick={() => setPending({ kind: v.eligible ? 'disable' : 'enable', voter: v })}>{v.eligible ? 'Bloquear' : 'Habilitar'}</button>
                  )}
                  {editable && !v.votedAt && <button className="btn small danger" onClick={() => setPending({ kind: 'remove', voter: v })}>Quitar</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Sin registros para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type VoterRow = ParticipationReport['voters'][number];
type PendingAction = { kind: 'enable' | 'disable' | 'remove' | 'reissue'; voter: VoterRow };

const ACTION_TEXT: Record<PendingAction['kind'], (org: string) => { title: string; detail: string; cta: string }> = {
  enable: (o) => ({ title: `Habilitar a ${o}`, detail: 'Podrá votar. Con la votación abierta, recibirá su código de inmediato.', cta: 'Habilitar' }),
  disable: (o) => ({ title: `Bloquear a ${o}`, detail: 'No podrá votar y su código actual dejará de funcionar.', cta: 'Bloquear' }),
  remove: (o) => ({ title: `Quitar a ${o} del padrón`, detail: 'Úsalo para registros erróneos o duplicados. Solo es posible si nunca votó. Queda registrado en la consola.', cta: 'Quitar del padrón' }),
  reissue: (o) => ({ title: `Reemitir el código de ${o}`, detail: 'Se le enviará un código nuevo y el anterior dejará de funcionar.', cta: 'Reemitir código' }),
};

/** Confirmación dentro de la página, con motivo cuando la votación está abierta. */
function ConfirmAction({ action, needsReason, onConfirm, onCancel }: {
  action: PendingAction; needsReason: boolean; onConfirm: (reason: string) => Promise<void>; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const t = ACTION_TEXT[action.kind](action.voter.organization);
  const valid = !needsReason || reason.trim().length >= 10;
  return (
    <div className="card confirm-panel" role="dialog" aria-labelledby="confirm-title">
      <h3 id="confirm-title">{t.title}</h3>
      <p className="help">{t.detail}</p>
      {needsReason && (
        <label>Motivo (obligatorio con la votación abierta; queda en la consola)
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: regularizó su cuota hoy" />
          {reason.length > 0 && reason.trim().length < 10 && <span className="muted small">Mínimo 10 caracteres</span>}
        </label>
      )}
      <div className="toolbar">
        <button className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className={`btn ${action.kind === 'remove' || action.kind === 'disable' ? 'danger' : 'primary'}`} disabled={!valid || busy}
          onClick={async () => { setBusy(true); await onConfirm(reason.trim()); setBusy(false); }}>
          {busy ? '…' : t.cta}
        </button>
      </div>
    </div>
  );
}

function AddVoter({ id, open, onDone }: { id: string; open: boolean; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({ ref: '', organization: '', email: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ codeIssued: boolean; emailed: boolean }>(`/admin/elections/${id}/voters`, { ...form, reason: form.reason || undefined }, true);
      onDone(r.codeIssued
        ? `${form.organization} agregada; ${r.emailed ? 'se le envió su código' : 'su código se emitió, pero el correo falló: reemítelo'}`
        : `${form.organization} agregada al padrón`);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.details?.length ? e2.details.join('. ') : e2.message);
    }
  }
  return (
    <form className="card add-voter" onSubmit={submit}>
      <div className="row three">
        <label>RUT o ID<input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} required /></label>
        <label>Empresa<input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} required /></label>
        <label>Correo<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
      </div>
      {open && (
        <label>Motivo (obligatorio con la votación abierta; queda en la consola)
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={10} />
        </label>
      )}
      <p className="help">{open ? 'Al agregarla quedará habilitada y recibirá su código de inmediato.' : 'Quedará habilitada; recibirá su código al emitirlos o al abrir.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary">Agregar</button>
    </form>
  );
}

/** Consola del proceso: eventos del log, sin tendencias. */
function ConsoleTab({ id }: { id: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; brokenAt?: number } | null>(null);
  useEffect(() => {
    const load = () => api.get<AuditEvent[]>(`/admin/elections/${id}/audit`, true).then(setEvents).catch(() => null);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [id]);
  return (
    <section>
      <div className="toolbar">
        <button className="btn" onClick={() => api.get<{ ok: boolean; brokenAt?: number }>(`/admin/elections/${id}/audit/verify`, true).then(setChain)}>
          Verificar integridad del registro
        </button>
        {chain && <span className={`notice inline ${chain.ok ? 'ok' : 'warn'}`}>{chain.ok ? 'Cadena íntegra' : `Cadena alterada en el evento #${chain.brokenAt}`}</span>}
      </div>
      <ol className="console">
        {[...events].reverse().map((e) => (
          <li key={e.seq}>
            <time>{new Date(e.createdAt).toLocaleString('es-CL')}</time>
            <span className="event">{EVENT_LABEL[e.type] ?? e.type}</span>
            <span className="actor">{e.actor}</span>
            <code className="hash" title={e.hash}>#{e.seq} · {e.hash.slice(0, 10)}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResultsTab({ id }: { id: string }) {
  const [ask, confirmUi] = useConfirm();
  const [r, setR] = useState<Results | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [check, setCheck] = useState<ActaVerification | null>(null);
  const load = useCallback(() => api.get<Results>(`/admin/elections/${id}/results`, true).then(setR), [id]);
  useEffect(() => { load(); }, [load]);
  if (!r) return <p>Cargando…</p>;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: ok }); await load(); } catch (e) { setMsg({ kind: 'warn', text: (e as ApiError).message }); }
  }

  // SVG no resuelve var(--x) en el atributo fill: leemos el valor real de la variable CSS.
  // Así el gráfico respeta el tema (claro/oscuro) y, en v2, la marca configurada.
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const color = { ELECTED: v('--accent'), TIED: v('--warn'), NOT_ELECTED: v('--muted-bar') };
  const official = r.source === 'ACTA' && r.acta;
  const pending = official ? r.acta!.pendingTies : false;
  const embedUrl = `${window.location.origin}/resultados/${id}`;
  const embedCode = `<iframe src="${embedUrl}" title="Resultados oficiales" style="width:100%;min-height:520px;border:0"></iframe>`;

  return (
    <section>
      {/* Origen del dato: conteo preliminar (cerrada) o acta oficial (escrutada) */}
      {official ? (
        <div className="card wide acta-card">
          <div className="acta-head">
            <div>
              <h2>Acta oficial · versión {r.acta!.version}</h2>
              <p className="muted small">
                {r.acta!.kind === 'RESOLUCION_EMPATE' ? 'Acta complementaria con resolución de empate · ' : ''}
                Emitida {new Date(r.acta!.createdAt).toLocaleString('es-CL')}
              </p>
              <code className="hash" title="Huella digital SHA-256 del acta">{r.acta!.hash}</code>
            </div>
            <div className="toolbar">
              <button className="btn small" onClick={() => api.download(`/admin/elections/${id}/actas/${r.acta!.version}/acta.html`, `acta-v${r.acta!.version}.html`)}>
                Descargar acta
              </button>
              <button className="btn small" onClick={() => api.get<ActaVerification>(`/admin/elections/${id}/actas/verify`, true).then(setCheck)}>
                Verificar acta vs. boletas
              </button>
            </div>
          </div>
          {check && (
            <div className={`notice ${check.chainOk && check.recountMatches ? 'ok' : 'warn'}`}>
              {!check.chainOk ? `La cadena de actas está alterada (versión ${check.brokenAtVersion}).`
                : check.recountMatches ? 'Cadena de actas íntegra y el recuento de boletas coincide con el acta.'
                : <>El recuento NO coincide con el acta:<ul>{check.differences.map((d) => <li key={d.candidate}>{d.position} · {d.candidate}: acta {d.acta}, recuento {d.recount}</li>)}</ul></>}
            </div>
          )}

          <h3>Comunicar resultados</h3>
          {confirmUi}
          {pending && <p className="notice warn">Hay empates pendientes. Registra su resolución abajo para habilitar la notificación y la publicación.</p>}
          <div className="toolbar">
            <button className="btn primary" disabled={pending || Boolean(r.publication?.membersNotifiedAt)}
              onClick={async () => (await ask({ title: '¿Enviar los resultados oficiales por correo?', detail: 'Se envía una sola vez a todos los socios del padrón, con la huella del acta vigente.', cta: 'Enviar resultados' })) &&
                run(() => api.post(`/admin/elections/${id}/notify-members`, {}, true), 'Resultados enviados a los socios')}>
              {r.publication?.membersNotifiedAt ? `Socios notificados el ${new Date(r.publication.membersNotifiedAt).toLocaleString('es-CL')}` : 'Notificar a los socios'}
            </button>
            <label className="switch">
              <input type="checkbox" disabled={pending} checked={Boolean(r.publication?.publicResults)}
                onChange={(e) => run(() => api.post(`/admin/elections/${id}/public-results`, { enabled: e.target.checked }, true),
                  e.target.checked ? 'Resultados públicos habilitados' : 'Resultados públicos deshabilitados')} />
              Resultados públicos e insertables
            </label>
          </div>
          {r.publication?.publicResults && (
            <div className="embed">
              <p className="help">Pega este código en la web de la organización. Muestra solo el acta oficial definitiva:</p>
              <textarea readOnly rows={3} value={embedCode} onFocus={(e) => e.target.select()} />
              <p className="help">
                Vista previa: <a href={embedUrl} target="_blank" rel="noreferrer">{embedUrl}</a> · Datos en JSON para un diseño propio:{' '}
                <code>/api/public/elections/{id}/results</code>
              </p>
            </div>
          )}
          {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
        </div>
      ) : (
        <p className="notice">Conteo <strong>preliminar</strong>. Al publicar el escrutinio se congela el acta oficial con su huella digital.</p>
      )}

      <div className="stats">
        <div className="stat"><span className="stat-value">{r.validBallots}</span><span className="stat-label">boletas válidas</span></div>
        <div className="stat"><span className="stat-value">{r.annulledBallots}</span><span className="stat-label">anuladas</span></div>
      </div>
      {r.positions.map((p) => (
        <div key={p.id} className="card wide result">
          <h2>{p.name} <span className="muted">· {p.seats} cupos</span></h2>
          {p.tie && !p.resolution && <p className="notice warn">Empate en el último cupo entre los candidatos marcados. Se resuelve fuera del sistema según el reglamento.</p>}
          {p.resolution && <p className="notice ok"><strong>Empate resuelto:</strong> {p.resolution.note}</p>}
          <div className="chart" style={{ height: Math.max(180, p.ranking.length * 40) }}>
            <ResponsiveContainer>
              <BarChart data={p.ranking} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 13 }} />
                <Tooltip formatter={(val) => [`${val} votos`, '']} />
                <Bar dataKey="votes" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {p.ranking.map((c) => <Cell key={c.candidateId} fill={color[c.status]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Candidato</th><th>Votos</th><th>Resultado</th></tr></thead>
              <tbody>
                {p.ranking.map((c, i) => (
                  <tr key={c.candidateId}>
                    <td>{i + 1}</td><td>{c.name}</td><td>{c.votes}</td>
                    <td>
                      <span className={`badge ${c.status}`}>{{ ELECTED: 'Electo', TIED: 'Empate', NOT_ELECTED: 'No electo' }[c.status]}</span>
                      {c.byResolution && <span className="muted small"> por resolución</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {official && p.tie && !p.resolution && <TieResolution electionId={id} position={p} onDone={() => run(async () => undefined, 'Acta complementaria emitida')} />}
        </div>
      ))}
    </section>
  );
}

/** Registra un empate resuelto fuera del sistema. Genera un acta complementaria. */
function TieResolution({ electionId, position, onDone }: { electionId: string; position: Results['positions'][number]; onDone: () => void }) {
  const tied = position.ranking.filter((c) => c.status === 'TIED');
  const remaining = position.seats - position.ranking.filter((c) => c.status === 'ELECTED').length;
  const [ask, confirmUi] = useConfirm();
  const [winners, setWinners] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toggle = (cid: string) => setWinners((w) => (w.includes(cid) ? w.filter((x) => x !== cid) : w.length < remaining ? [...w, cid] : w));

  async function submit() {
    setError(null);
    if (!(await ask({ title: '¿Emitir el acta complementaria?', detail: 'Queda registrada con su huella y no se puede modificar.', cta: 'Emitir acta' }))) return;
    try {
      await api.post(`/admin/elections/${electionId}/ties/resolve`, { positionId: position.id, winners, note }, true);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  return (
    <div className="tie-box">
      <h3>Registrar resolución del empate</h3>
      <p className="help">Queda{remaining > 1 ? 'n' : ''} {remaining} cupo{remaining > 1 ? 's' : ''} por asignar. Marca a quién{remaining > 1 ? 'es' : ''} se le asignó según el proceso definido fuera del sistema.</p>
      <div className="candidates">
        {tied.map((c) => (
          <label key={c.candidateId} className={`candidate ${winners.includes(c.candidateId) ? 'checked' : ''}`}>
            <input type="checkbox" checked={winners.includes(c.candidateId)} onChange={() => toggle(c.candidateId)}
              disabled={!winners.includes(c.candidateId) && winners.length >= remaining} />
            <span className="candidate-name">{c.name}</span>
          </label>
        ))}
      </div>
      <label>Fundamento (queda en el acta)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: Candidata X cede el cupo de mutuo acuerdo, según acta de comisión del 12-10." />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {confirmUi}
      <button className="btn primary" disabled={winners.length !== remaining || note.trim().length < 10} onClick={submit}>Emitir acta complementaria</button>
    </div>
  );
}

function RollTab({ election, onDone }: { election: Election; onDone: () => void }) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string; errors?: string[] } | null>(null);
  const [reason, setReason] = useState('');
  const closed = election.status === 'CLOSED' || election.status === 'TALLIED';

  async function upload(file: File) {
    try {
      const r = await api.postFile<{ total: number; eligible: number }>(`/admin/elections/${election.id}/voters/import`, file);
      setMsg({ kind: 'ok', text: `Padrón cargado: ${r.total} registros, ${r.eligible} habilitados.` });
      onDone();
    } catch (err) {
      const e = err as ApiError;
      setMsg({ kind: 'warn', text: e.message, errors: e.details });
    }
  }
  const dl = (path: string, name: string) =>
    api.download(`/admin/elections/${election.id}/reports/${path}`, name).catch((e) => setMsg({ kind: 'warn', text: e.message }));

  return (
    <section className="grid-2">
      <div className="card">
        <h2>Padrón</h2>
        <p className="help">Excel (.xlsx) o CSV, con separador coma o punto y coma. Reemplaza el padrón completo. Solo en borrador.</p>
        <TemplateLinks kind="padron" />
        <input type="file" accept=".xlsx,.csv,text/csv" disabled={election.status !== 'DRAFT'}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        {msg && (msg.errors?.length ? <><p className="notice warn">{msg.text}</p><FileErrors errors={msg.errors} /></> : <p className={`notice ${msg.kind}`}>{msg.text}</p>)}
      </div>
      <div className="card">
        <h2>Reportes</h2>
        <div className="stack">
          <button className="btn" disabled={!closed} onClick={() => dl('results.csv', 'resultados.csv')}>Resultados (CSV)</button>
          <button className="btn" disabled={!closed} onClick={() => dl('ballots.csv', 'boletas.csv')}>Boletas para recuento (CSV)</button>
          <button className="btn" onClick={() => dl(`participation.csv${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`, 'participacion.csv')}>
            Participación (CSV)
          </button>
          <label className="help">Motivo del acceso (obligatorio para auditor; habilita IP y dispositivo)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: revisión solicitada por la asamblea" />
          </label>
        </div>
      </div>
    </section>
  );
}

function AnnulmentsTab({ id, open }: { id: string; open: boolean }) {
  const [list, setList] = useState<Annulment[]>([]);
  const [voters, setVoters] = useState<ParticipationReport['voters']>([]);
  const [form, setForm] = useState({ voterId: '', receipt: '', reason: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const load = useCallback(() => {
    api.get<Annulment[]>(`/admin/elections/${id}/annulments`, true).then(setList);
    api.get<ParticipationReport>(`/admin/elections/${id}/participation`, true).then((p) => setVoters(p.voters.filter((v) => v.votedAt)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); setMsg({ kind: 'ok', text: ok }); load(); } catch (e) { setMsg({ kind: 'warn', text: (e as ApiError).message }); }
  }
  const orgOf = (voterId: string) => voters.find((v) => v.id === voterId)?.organization ?? voterId.slice(0, 8);

  return (
    <section className="grid-2">
      <div className="card">
        <h2>Solicitar anulación</h2>
        <p className="help">Requiere el código de recibo que entrega el votante. La solicitud la aprueba el rol Auditor; la boleta queda marcada como anulada y el votante recibe un código nuevo.</p>
        <label>Empresa
          <select value={form.voterId} onChange={(e) => setForm({ ...form, voterId: e.target.value })} disabled={!open}>
            <option value="">Selecciona…</option>
            {voters.map((v) => <option key={v.id} value={v.id}>{v.organization}</option>)}
          </select>
        </label>
        <label>Código de recibo<input value={form.receipt} onChange={(e) => setForm({ ...form, receipt: e.target.value })} disabled={!open} /></label>
        <label>Motivo<textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} disabled={!open} /></label>
        <button className="btn" disabled={!open || !form.voterId || !form.receipt || form.reason.length < 10}
          onClick={() => run(() => api.post(`/admin/elections/${id}/annulments`, form, true), 'Solicitud registrada. Pendiente de aprobación del auditor.')}>
          Solicitar
        </button>
        {!open && <p className="muted small">Solo disponible con la votación abierta.</p>}
        {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
      </div>
      <div className="card">
        <h2>Solicitudes</h2>
        {list.length === 0 && <p className="muted">Sin solicitudes.</p>}
        <ul className="annulments">
          {list.map((a) => (
            <li key={a.id}>
              <div><strong>{orgOf(a.voterId)}</strong> · <span className={`badge ${a.status}`}>{{ REQUESTED: 'Pendiente', APPROVED: 'Aprobada', REJECTED: 'Rechazada' }[a.status]}</span></div>
              <p className="small">{a.reason}</p>
              {a.status === 'REQUESTED' && (
                <div className="toolbar">
                  <button className="btn small primary" onClick={() => run(() => api.post(`/admin/elections/${id}/annulments/${a.id}/approve`, {}, true), 'Anulación aprobada')}>Aprobar (auditor)</button>
                  <button className="btn small" onClick={() => run(() => api.post(`/admin/elections/${id}/annulments/${a.id}/reject`, {}, true), 'Anulación rechazada')}>Rechazar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
