import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { auth } from './api/client';
import { VoterFlow } from './pages/VoterFlow';
import { VerifyReceipt } from './pages/VerifyReceipt';
import { AdminElections, AdminLogin } from './pages/AdminElections';
import { AdminElection } from './pages/AdminElection';
import { PublicResults } from './pages/PublicResults';
import './styles.css';

/** Protege las rutas de admin: sin clave en la sesión, muestra el login. */
function AdminGate({ children }: { children: JSX.Element }) {
  const [logged, setLogged] = useState(Boolean(auth.get()));
  if (!logged) return <AdminLogin onLogin={() => setLogged(true)} />;
  return (
    <>
      <div className="admin-bar">
        <Link to="/admin">Comisión electoral</Link>
        <button className="btn small" onClick={() => { auth.clear(); setLogged(false); }}>Salir</button>
      </div>
      {children}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<VoterFlow />} />
        <Route path="/verificar" element={<VerifyReceipt />} />
        <Route path="/resultados/:id" element={<PublicResults />} />
        <Route path="/admin" element={<AdminGate><AdminElections /></AdminGate>} />
        <Route path="/admin/:id" element={<AdminGate><AdminElection /></AdminGate>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
