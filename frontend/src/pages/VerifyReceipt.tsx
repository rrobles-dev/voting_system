import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { T } from '../messages';

type Outcome = { found: false } | { found: true; status: 'VALID' | 'ANNULLED' };

export function VerifyReceipt() {
  const [receipt, setReceipt] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setOutcome(await api.get<Outcome>(`/voting/receipt/${encodeURIComponent(receipt.trim())}`));
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <main className="voter">
      <section className="card">
        <h1>{T.verify.title}</h1>
        <p className="lead">{T.verify.lead}</p>
        <form onSubmit={submit} className="code-form">
          <label htmlFor="receipt">{T.verify.label}</label>
          <input id="receipt" className="code-input" value={receipt} onChange={(e) => setReceipt(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <button className="btn primary">{T.verify.submit}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {outcome && (
          <p className={`notice ${outcome.found && outcome.status === 'VALID' ? 'ok' : 'warn'}`} role="status">
            {!outcome.found ? T.verify.notFound : outcome.status === 'VALID' ? T.verify.found : T.verify.annulled}
          </p>
        )}
        <Link to="/" className="link">← Volver</Link>
      </section>
    </main>
  );
}
