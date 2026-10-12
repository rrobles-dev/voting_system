import { api } from '../api/client';

/** Enlaces de descarga de plantillas. Excel es la opción recomendada para usuarios no técnicos. */
export function TemplateLinks({ kind }: { kind: 'padron' | 'candidatos' }) {
  const label = kind === 'padron' ? 'padrón' : 'candidatos';
  const dl = (ext: 'xlsx' | 'csv') => api.download(`/admin/templates/${kind}.${ext}`, `plantilla-${kind}.${ext}`);
  return (
    <p className="help template-links">
      Plantilla de {label}:{' '}
      <button type="button" className="link-btn" onClick={() => dl('xlsx')}>Excel (.xlsx)</button>{' · '}
      <button type="button" className="link-btn" onClick={() => dl('csv')}>CSV</button>
    </p>
  );
}

/** Lista de errores de validación de un archivo, todos juntos para corregir de una vez. */
export function FileErrors({ errors, title }: { errors?: string[]; title?: string }) {
  if (!errors?.length) return null;
  return (
    <div className="notice warn">
      {title ?? `El archivo tiene ${errors.length} problema${errors.length > 1 ? 's' : ''}:`}
      <ul>{errors.slice(0, 15).map((e) => <li key={e}>{e}</li>)}</ul>
      {errors.length > 15 && <p className="small">…y {errors.length - 15} más.</p>}
    </div>
  );
}

/** Advertencias que no bloquean: la comisión debe confirmar explícitamente que las revisó. */
export function WarningsConfirm({ warnings, confirmed, onChange, label }: {
  warnings?: string[]; confirmed: boolean; onChange: (v: boolean) => void; label: string;
}) {
  if (!warnings?.length) return null;
  return (
    <div className="notice warn">
      <strong>Revisa {warnings.length > 1 ? `estas ${warnings.length} advertencias` : 'esta advertencia'}:</strong>
      <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      <label className="switch"><input type="checkbox" checked={confirmed} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
    </div>
  );
}
