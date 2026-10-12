import { useCallback, useRef, useState } from 'react';

/**
 * Confirmación dentro de la página, como reemplazo de window.confirm().
 * window.confirm/prompt dependen del navegador: algunos navegadores integrados y los iframes
 * aislados los bloquean y devuelven "cancelar" sin mostrar nada, y el botón parece roto.
 *
 * Uso:
 *   const [ask, confirmUi] = useConfirm();
 *   if (await ask({ title: '¿Cerrar?', cta: 'Cerrar', danger: true })) { ... }
 *   return <>{confirmUi}...</>;
 */
interface Ask { title: string; detail?: string; cta: string; danger?: boolean }

export function useConfirm(): [(q: Ask) => Promise<boolean>, JSX.Element | null] {
  const [question, setQuestion] = useState<Ask | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const ask = useCallback((q: Ask) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setQuestion(q);
  }), []);

  const answer = (v: boolean) => {
    resolver.current?.(v);
    setQuestion(null);
  };

  const ui = question && (
    <div className="card confirm-panel" role="alertdialog" aria-labelledby="confirm-q">
      <h3 id="confirm-q">{question.title}</h3>
      {question.detail && <p className="help">{question.detail}</p>}
      <div className="toolbar">
        <button className="btn" onClick={() => answer(false)}>Cancelar</button>
        <button className={`btn ${question.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => answer(true)}>{question.cta}</button>
      </div>
    </div>
  );
  return [ask, ui];
}
