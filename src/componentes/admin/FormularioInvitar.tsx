'use client';

import Link from 'next/link';
import { useState } from 'react';
import { invitarUsuarioAccion } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { botonVariantes } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { GrupoRadios } from '@/componentes/ui/casilla';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { AREAS } from '@/dominio/areas';
import { ROLES, type Rol } from '@/dominio/permisos';
import { FormularioAccion } from './acciones';
import { ROL_DESCRIPCION, ROL_ETIQUETA } from './formato';

interface Org {
  id: string;
  nombre: string;
  tipo: 'interna' | 'agencia';
}

/**
 * Invitar a una persona (10.4): nombre, correo, organizacion y rol. Si la organizacion es una agencia, el unico
 * rol que se ofrece es `aduana` (D-28): se explica en pantalla en vez de dejar un radio sin opciones.
 */
export function FormularioInvitar({ organizaciones, organizacionInicial, vigenciaMinutos }: { organizaciones: Org[]; organizacionInicial?: string; vigenciaMinutos: number }) {
  const internas = organizaciones.filter((o) => o.tipo === 'interna');
  const agencias = organizaciones.filter((o) => o.tipo === 'agencia');
  // Por defecto, la primera opcion que se pinta (las areas internas van primero), no la primera del arreglo.
  const [orgId, setOrgId] = useState(
    organizacionInicial && organizaciones.some((o) => o.id === organizacionInicial) ? organizacionInicial : (internas[0]?.id ?? agencias[0]?.id ?? ''),
  );
  const org = organizaciones.find((o) => o.id === orgId);
  const esAgencia = org?.tipo === 'agencia';
  const [rolElegido, setRolElegido] = useState<Rol>('solicitante');
  const rol: Rol = esAgencia ? 'aduana' : rolElegido;

  if (organizaciones.length === 0) {
    return (
      <Aviso
        tipo="aviso"
        titulo="Primero crea una organización"
        accion={
          <Link href="/admin/organizaciones" className={botonVariantes({ variante: 'secundario', tamano: 'sm' })}>
            Ir a organizaciones
          </Link>
        }
      >
        Cada persona pertenece a una organización interna o a una agencia de aduana.
      </Aviso>
    );
  }

  return (
    <FormularioAccion
      accion={invitarUsuarioAccion}
      enviar="Invitar y enviar el enlace"
      enviando="Invitando…"
      className="space-y-6"
      secundario={
        <Link href="/admin/usuarios" className={botonVariantes({ variante: 'terciario' })}>
          Cancelar
        </Link>
      }
    >
      {(estado) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <CampoFormulario etiqueta={esAgencia ? 'Nombre de la cuenta (ej. Agencia X)' : 'Nombre completo'} error={estado.errores?.nombre}>
              {(p) => <Campo {...p} name="nombre" autoComplete="off" required maxLength={200} />}
            </CampoFormulario>
            <CampoFormulario etiqueta="Correo" ayuda="Aquí le llega el enlace para entrar." error={estado.errores?.email}>
              {(p) => <Campo {...p} name="email" type="email" inputMode="email" autoComplete="off" required maxLength={254} />}
            </CampoFormulario>
          </div>

          <CampoFormulario etiqueta="Organización" error={estado.errores?.organizacionId}>
            {(p) => (
              <Seleccion {...p} name="organizacionId" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {internas.length > 0 ? (
                  <optgroup label="Internas">
                    {internas.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {agencias.length > 0 ? (
                  <optgroup label="Agencias de aduana">
                    {agencias.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Seleccion>
            )}
          </CampoFormulario>

          {esAgencia ? (
            <div className="space-y-2">
              <input type="hidden" name="rol" value="aduana" />
              <Aviso tipo="info" titulo="Rol: Aduana">
                Esta es la cuenta general de la agencia (un correo de la empresa, sin datos personales). Solo tiene el rol de aduana
                y ve únicamente las referencias que le envíen.
              </Aviso>
            </div>
          ) : (
            <GrupoRadios
              leyenda="Rol"
              nombre="rol"
              valor={rol}
              onCambio={(v) => setRolElegido(v as Rol)}
              error={estado.errores?.rol}
              opciones={ROLES.map((r) => ({ valor: r, etiqueta: ROL_ETIQUETA[r], descripcion: ROL_DESCRIPCION[r] }))}
            />
          )}

          {!esAgencia ? (
            <CampoFormulario
              etiqueta="Área"
              ayuda="Ve en «Para mí» las referencias de su área y recibe las solicitudes de la aduana sobre ellas."
              opcional
              error={estado.errores?.area}
            >
              {(p) => (
                <Seleccion {...p} name="area" defaultValue="" className="max-w-xs">
                  <option value="">Sin área</option>
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Seleccion>
              )}
            </CampoFormulario>
          ) : null}

          <p className="text-sm text-tinta-suave">
            Al invitar, enviamos {esAgencia ? 'al correo de la cuenta' : 'un correo'} un enlace que dura {vigenciaMinutos} minutos. Después se puede pedir otro desde la
            pantalla de entrada.
          </p>
        </>
      )}
    </FormularioAccion>
  );
}
