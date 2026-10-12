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
export function FileErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div className="notice warn">
      El archivo tiene {errors.length} problema{errors.length > 1 ? 's' : ''}:
      <ul>{errors.slice(0, 15).map((e) => <li key={e}>{e}</li>)}</ul>
      {errors.length > 15 && <p className="small">…y {errors.length - 15} más.</p>}
    </div>
  );
}
