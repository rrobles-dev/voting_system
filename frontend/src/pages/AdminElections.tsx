import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, auth } from '../api/client';
import type { Election } from '../api/types';
import { ElectionForm } from '../components/ElectionForm';

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
  const navigate = useNavigate();
  const [elections, setElections] = useState<Election[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => { api.get<Election[]>('/admin/elections', true).then(setElections); }, []);

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Procesos de votación</h1>
        {!creating && <button className="btn primary" onClick={() => setCreating(true)}>Nuevo proceso</button>}
      </header>
      {creating && <ElectionForm onDone={(id) => navigate(`/admin/${id}`)} onCancel={() => setCreating(false)} />}
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
