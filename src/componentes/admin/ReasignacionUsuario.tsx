'use client';

import { ArrowRight, UserX } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cambiarOrganizacionAccion, desactivarUsuarioAccion } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Seleccion } from '@/componentes/ui/input';
import { Insignia } from '@/componentes/ui/insignia';
import { cn } from '@/lib/utils';
import { BotonAccion, FormularioAccion } from './acciones';
import { ETIQUETA_PEDIDO, plural, ROL_ETIQUETA } from './formato';

export interface PendienteVista {
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  pedido: string | null;
  deNombre: string;
  /** Texto ya formateado («hace 3 días»). */
  desde: string;
}

export interface CandidatoVista {
  id: string;
  nombre: string;
  rol: string;
  organizacion: string;
  organizacionId: string;
  organizacionTipo: string;
  pendientes: number;
}

interface UsuarioVista {
  id: string;
  nombre: string;
  organizacionId: string;
  organizacionTipo: 'interna' | 'agencia';
  rol: string;
}

/**
 * La lista que GUIA la reasignacion: una fila por referencia pendiente, con quien la envio y desde cuando, y un
 * selector de destino. Los candidatos se agrupan: primero la misma organizacion de quien se va (si es agencia,
 * quedarse en la agencia es lo que conserva la ficha), despues el resto.
 */
function ListaReasignacion({
  usuario,
  pendientes,
  candidatos,
  soloMismaOrganizacion,
  valores,
  alCambiar,
  faltan,
}: {
  usuario: UsuarioVista;
  pendientes: PendienteVista[];
  candidatos: CandidatoVista[];
  soloMismaOrganizacion: boolean;
  valores: Record<string, string>;
  alCambiar: (referenciaId: string, destino: string) => void;
  faltan: Set<string>;
}) {
  const propios = candidatos.filter((c) => c.organizacionId === usuario.organizacionId);
  const otros = soloMismaOrganizacion ? [] : candidatos.filter((c) => c.organizacionId !== usuario.organizacionId);
  const [todas, setTodas] = useState('');

  const opciones = (
    <>
      <option value="">Elige a quién…</option>
      {propios.length > 0 ? (
        <optgroup label={soloMismaOrganizacion || usuario.organizacionTipo === 'agencia' ? 'Misma organización' : 'Su área'}>
          {propios.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {ROL_ETIQUETA[c.rol as keyof typeof ROL_ETIQUETA]} · {plural(c.pendientes, 'pendiente', 'pendientes')}
            </option>
          ))}
        </optgroup>
      ) : null}
      {otros.length > 0 ? (
        <optgroup label="Otras organizaciones">
          {otros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {c.organizacion} · {plural(c.pendientes, 'pendiente', 'pendientes')}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );

  const hayAgenciaOrigen = usuario.organizacionTipo === 'agencia';

  return (
    <div className="space-y-4">
      {candidatos.length === 0 ? (
        <Aviso tipo="error" titulo="No hay a quién reasignar">
          {soloMismaOrganizacion
            ? 'La agencia no tiene otra persona activa que pueda recibir estas referencias. Invita primero a alguien de la misma agencia.'
            : 'No hay otra persona activa que pueda recibirlas. Invita o reactiva a alguien y vuelve a intentar.'}
        </Aviso>
      ) : (
        <>
          {pendientes.length > 1 ? (
            <div className="rounded-lg border border-borde-suave bg-superficie-2 p-3">
              <CampoFormulario etiqueta="Asignar todas a la misma persona" ayuda="Atajo: elige una persona y se la ponemos a las demás filas. Puedes cambiar cada una después.">
                {(p) => (
                  <Seleccion
                    {...p}
                    value={todas}
                    onChange={(e) => {
                      setTodas(e.target.value);
                      if (e.target.value) for (const x of pendientes) alCambiar(x.referenciaId, e.target.value);
                    }}
                  >
                    {opciones}
                  </Seleccion>
                )}
              </CampoFormulario>
            </div>
          ) : null}
          {hayAgenciaOrigen && !soloMismaOrganizacion ? (
            <Aviso tipo="aviso">Si eliges a alguien de otra organización, la agencia deja de ver esa referencia.</Aviso>
          ) : null}
        </>
      )}

      <ul aria-label="Referencias pendientes" className="divide-y divide-borde-suave overflow-hidden rounded-xl border border-borde-suave bg-superficie">
        {pendientes.map((p) => {
          const falta = faltan.has(p.referenciaId);
          return (
            <li key={p.referenciaId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/referencias/${p.referenciaId}`} className="font-mono text-sm font-bold text-azul-700 underline-offset-2 hover:underline">
                    {p.codigo}
                  </Link>
                  {p.pedido ? <Insignia variante="azul">{ETIQUETA_PEDIDO[p.pedido] ?? p.pedido}</Insignia> : null}
                </p>
                <p className="mt-0.5 truncate text-base font-semibold text-tinta">{p.nombreProducto}</p>
                <p className="text-sm text-tinta-suave">
                  Enviada por {p.deNombre} · {p.desde}
                </p>
              </div>
              <CampoFormulario etiqueta={`Reasignar ${p.codigo} a`} error={falta ? 'Elige a quién se la pasas.' : undefined}>
                {(c) => (
                  <Seleccion {...c} name={`reasig:${p.referenciaId}`} value={valores[p.referenciaId] ?? ''} onChange={(e) => alCambiar(p.referenciaId, e.target.value)}>
                    {opciones}
                  </Seleccion>
                )}
              </CampoFormulario>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function useReasignaciones(pendientes: PendienteVista[]) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const faltan = useMemo(() => new Set(pendientes.filter((p) => !valores[p.referenciaId]).map((p) => p.referenciaId)), [pendientes, valores]);
  return {
    valores,
    faltan,
    elegidas: pendientes.length - faltan.size,
    alCambiar: (ref: string, destino: string) => setValores((v) => ({ ...v, [ref]: destino })),
  };
}

/** Desactivar a una persona. Con pendientes, la reasignacion es OBLIGATORIA y se hace aqui mismo (10.6). */
export function PanelDesactivar({
  usuario,
  pendientes,
  candidatos,
  unicoAdministrador,
}: {
  usuario: UsuarioVista;
  pendientes: PendienteVista[];
  candidatos: CandidatoVista[];
  unicoAdministrador: boolean;
}) {
  const r = useReasignaciones(pendientes);

  if (unicoAdministrador) {
    return (
      <Aviso tipo="aviso" titulo="No se puede desactivar">
        {usuario.nombre} es el único administrador activo. Dale el rol de administrador a otra persona primero; así la plataforma nunca se queda sin quién la administre.
      </Aviso>
    );
  }

  if (pendientes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-base text-tinta-suave">No tiene referencias pendientes. Al desactivarlo dejará de entrar y cerramos sus sesiones al instante.</p>
        <BotonAccion
          accion={desactivarUsuarioAccion}
          campos={{ usuarioId: usuario.id }}
          variante="peligro"
          tamano="md"
          confirmar={{
            titulo: `Desactivar a ${usuario.nombre}`,
            descripcion: `${usuario.nombre} dejará de entrar y se cerrarán sus sesiones ahora mismo. Lo que ya llenó se conserva, y puedes reactivarlo cuando quieras.`,
            confirmar: 'Desactivar',
            cancelar: 'Todavía no',
            peligro: true,
          }}
        >
          <UserX aria-hidden className="size-4" />
          Desactivar a {usuario.nombre}
        </BotonAccion>
      </div>
    );
  }

  const completo = r.faltan.size === 0;
  return (
    <FormularioAccion
      accion={desactivarUsuarioAccion}
      enviar="Reasignar y desactivar"
      enviando="Reasignando…"
      variante="peligro"
      tamano="md"
      deshabilitado={!completo || candidatos.length === 0}
      pieIzquierdo={
        <p className={cn('text-sm', completo ? 'font-semibold text-azul-800' : 'text-tinta-suave')} aria-live="polite">
          {completo ? 'Todas tienen nueva persona.' : `${r.elegidas} de ${pendientes.length} con nueva persona.`}
        </p>
      }
    >
      <input type="hidden" name="usuarioId" value={usuario.id} />
      <div className="space-y-4">
        <p className="text-base text-tinta">
          <strong>{usuario.nombre}</strong> tiene {plural(pendientes.length, 'referencia pendiente', 'referencias pendientes')}. ¿A quién {pendientes.length === 1 ? 'la reasignas' : 'las reasignas'}?
        </p>
        <ListaReasignacion
          usuario={usuario}
          pendientes={pendientes}
          candidatos={candidatos}
          soloMismaOrganizacion={false}
          valores={r.valores}
          alCambiar={r.alCambiar}
          faltan={new Set()}
        />
        <p className="flex items-start gap-2 text-sm text-tinta-suave">
          <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0" />
          La reasignación y el cierre de sus sesiones ocurren juntas. Lo que {usuario.nombre} ya llenó se conserva en el historial de cada referencia.
        </p>
      </div>
    </FormularioAccion>
  );
}

interface OrgVista {
  id: string;
  nombre: string;
  tipo: 'interna' | 'agencia';
}

/** Cambiar a una persona de organizacion. Si una de las dos es agencia y tiene pendientes, hay que reasignarlos. */
export function PanelCambiarOrganizacion({
  usuario,
  organizaciones,
  pendientes,
  candidatos,
}: {
  usuario: UsuarioVista;
  organizaciones: OrgVista[];
  pendientes: PendienteVista[];
  candidatos: CandidatoVista[];
}) {
  const [destinoId, setDestinoId] = useState(usuario.organizacionId);
  const destino = organizaciones.find((o) => o.id === destinoId);
  const r = useReasignaciones(pendientes);
  const cambia = destinoId !== usuario.organizacionId;
  const intervieneAgencia = usuario.organizacionTipo === 'agencia' || destino?.tipo === 'agencia';
  const exige = cambia && intervieneAgencia && pendientes.length > 0;
  const soloMisma = usuario.organizacionTipo === 'agencia';
  const candidatosValidos = soloMisma ? candidatos.filter((c) => c.organizacionId === usuario.organizacionId) : candidatos;
  const completo = !exige || r.faltan.size === 0;
  const internas = organizaciones.filter((o) => o.tipo === 'interna');
  const agencias = organizaciones.filter((o) => o.tipo === 'agencia');
  const aAgenciaNoPermitido = (o: OrgVista) => o.tipo === 'agencia' && usuario.rol !== 'aduana';

  return (
    <FormularioAccion
      accion={cambiarOrganizacionAccion}
      enviar="Cambiar de organización"
      enviando="Cambiando…"
      deshabilitado={!cambia || !completo || (exige && candidatosValidos.length === 0)}
      className="space-y-4"
    >
      {(estado) => (
        <>
          <input type="hidden" name="usuarioId" value={usuario.id} />
          <CampoFormulario etiqueta="Organización" error={estado.errores?.organizacionId}>
            {(p) => (
              <Seleccion {...p} name="organizacionId" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                <optgroup label="Internas">
                  {internas.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </optgroup>
                {agencias.length > 0 ? (
                  <optgroup label="Agencias de aduana">
                    {agencias.map((o) => (
                      <option key={o.id} value={o.id} disabled={aAgenciaNoPermitido(o)}>
                        {o.nombre}
                        {aAgenciaNoPermitido(o) ? ' (solo para rol Aduana)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Seleccion>
            )}
          </CampoFormulario>
          {usuario.rol !== 'aduana' ? (
            <p className="text-sm text-tinta-suave">Las agencias solo admiten el rol Aduana. Para mover a esta persona a una agencia, cambia primero su rol.</p>
          ) : null}
          {exige ? (
            <div className="space-y-3">
              <Aviso tipo="aviso" titulo={`${usuario.nombre} tiene ${plural(pendientes.length, 'referencia pendiente', 'referencias pendientes')}`}>
                {soloMisma
                  ? 'Como sale de una agencia, sus referencias se quedan con la agencia: pásaselas a alguien de la misma organización.'
                  : 'Como entra a una agencia, sus referencias no pueden ir con él o ella: pásaselas a otra persona.'}
              </Aviso>
              <ListaReasignacion
                usuario={usuario}
                pendientes={pendientes}
                candidatos={candidatosValidos}
                soloMismaOrganizacion={soloMisma}
                valores={r.valores}
                alCambiar={r.alCambiar}
                faltan={new Set()}
              />
            </div>
          ) : null}
        </>
      )}
    </FormularioAccion>
  );
}
