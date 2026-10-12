import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { BallotSession, CastResult, Position } from '../api/types';
import { T } from '../messages';

/**
 * Flujo del votante como máquina de estados en un solo componente:
 * code → ballot → review → done.
 * El código vive solo en memoria (no en localStorage): si recarga la página,
 * vuelve a ingresarlo. El código no se consume hasta confirmar el voto.
 */
type Step = 'code' | 'ballot' | 'review' | 'done';
type Selections = Record<string, string[]>;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' });

export function VoterFlow() {
  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<BallotSession | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [result, setResult] = useState<CastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await api.post<BallotSession>('/voting/session', { code: code.trim() });
      setSession(s);
      setSelections(Object.fromEntries(s.election.positions.map((p) => [p.id, []])));
      setStep('ballot');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function cast() {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.post<CastResult>('/voting/ballot', { code: code.trim(), selections }));
      setCode('');
      setStep('done');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="voter">
      {step === 'code' && (
        <section className="card" aria-labelledby="welcome-title">
          <h1 id="welcome-title">{T.welcome.title}</h1>
          <p className="lead">{T.welcome.lead}</p>
          <ol className="steps">
            {T.welcome.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <form onSubmit={submitCode} className="code-form">
            <label htmlFor="code">{T.welcome.codeLabel}</label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className="code-input"
              maxLength={16}
              required
              aria-describedby="code-help"
            />
            <p id="code-help" className="help">{T.welcome.codeHelp}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy || code.trim().length < 6}>
              {busy ? '…' : T.welcome.submit}
            </button>
          </form>
          <p className="fineprint">{T.welcome.privacy}</p>
          <Link to="/verificar" className="link">{T.welcome.verifyLink}</Link>
        </section>
      )}

      {step === 'ballot' && session && (
        <BallotStep
          session={session}
          selections={selections}
          onChange={setSelections}
          onNext={() => { setError(null); setStep('review'); }}
        />
      )}

      {step === 'review' && session && (
        <section className="card" aria-labelledby="review-title">
          <h1 id="review-title">{T.review.title}</h1>
          <p className="lead">{T.review.lead}</p>
          {session.election.positions.map((p) => {
            const chosen = p.candidates.filter((c) => selections[p.id]?.includes(c.id));
            return (
              <div key={p.id} className="review-block">
                <h2>{p.name}</h2>
                {chosen.length ? (
                  <ul className="review-list">{chosen.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
                ) : (
                  <p className="muted">{T.review.none}</p>
                )}
              </div>
            );
          })}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => setStep('ballot')} disabled={busy}>{T.review.back}</button>
            <button className="btn primary" onClick={cast} disabled={busy}>
              {busy ? T.review.sending : T.review.confirm}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && result && <DoneStep result={result} />}
    </main>
  );
}

function BallotStep({ session, selections, onChange, onNext }: {
  session: BallotSession; selections: Selections; onChange: (s: Selections) => void; onNext: () => void;
}) {
  const { election } = session;
  const valid = election.positions.every((p) => {
    const n = selections[p.id]?.length ?? 0;
    return n >= p.minSelection && n <= p.maxSelection;
  });

  function toggle(p: Position, candidateId: string) {
    const current = selections[p.id] ?? [];
    let next: string[];
    if (p.maxSelection === 1) next = current[0] === candidateId ? [] : [candidateId]; // comportamiento tipo radio
    else if (current.includes(candidateId)) next = current.filter((id) => id !== candidateId);
    else if (current.length < p.maxSelection) next = [...current, candidateId];
    else return; // tope alcanzado: no se marca más
    onChange({ ...selections, [p.id]: next });
  }

  return (
    <section className="card wide" aria-labelledby="ballot-title">
      <p className="eyebrow">{T.ballot.votingAs} <strong>{session.organization}</strong></p>
      <h1 id="ballot-title">{election.title}</h1>
      {election.description && <p className="lead">{election.description}</p>}
      <p className="help">{T.ballot.closesAt} {fmtDate(election.closesAt)}.</p>

      {election.positions.map((p) => {
        const n = selections[p.id]?.length ?? 0;
        const full = n >= p.maxSelection && p.maxSelection > 1;
        return (
          <fieldset key={p.id} className="position">
            <legend>{p.name}</legend>
            <p className="instructions">{T.ballot.instructions(p.minSelection, p.maxSelection, p.seats)}</p>
            <p className={`counter ${full ? 'full' : ''}`} aria-live="polite">{T.ballot.counter(n, p.maxSelection)}</p>
            <div className="candidates">
              {p.candidates.map((c) => {
                const checked = selections[p.id]?.includes(c.id) ?? false;
                const disabled = !checked && full;
                return (
                  <label key={c.id} className={`candidate ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}>
                    <input
                      type={p.maxSelection === 1 ? 'radio' : 'checkbox'}
                      name={p.id}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(p, c.id)}
                    />
                    <span className="candidate-text">
                      <span className="candidate-name">{c.name}</span>
                      {c.detail && <span className="candidate-detail">{c.detail}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="actions sticky">
        <button className="btn primary" onClick={onNext} disabled={!valid}>{T.ballot.review}</button>
      </div>
    </section>
  );
}

function DoneStep({ result }: { result: CastResult }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.receipt);
      setCopied(true);
    } catch { /* el usuario puede copiarlo a mano */ }
  }
  return (
    <section className="card" aria-labelledby="done-title">
      <div className="check" aria-hidden>✓</div>
      <h1 id="done-title">{T.done.title}</h1>
      <p className="lead">{T.done.lead}</p>
      <p className="muted">{result.electionTitle} · {fmtDate(result.votedAt)}</p>
      <div className="receipt">
        <span className="receipt-label">{T.done.receiptLabel}</span>
        <code className="receipt-code" data-testid="receipt">{result.receipt}</code>
        <button className="btn small" onClick={copy}>{copied ? T.done.copied : T.done.copy}</button>
      </div>
      <p className="help">{T.done.receiptHelp}</p>
      <a className="btn" href="/">{T.done.exit}</a>
    </section>
  );
}
