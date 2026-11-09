'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { crearCuentaAccion, type EstadoAdmin, type SecretoEntrega } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { botonVariantes } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { GrupoRadios } from '@/componentes/ui/casilla';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { AREAS, exigeArea, nombreDeArea } from '@/dominio/areas';
import { normalizarUsuario } from '@/dominio/credenciales';
import { ROLES, type Rol } from '@/dominio/permisos';
import { FormularioAccion } from './acciones';
import { CredencialesEntrega } from './CredencialesEntrega';
import { ROL_DESCRIPCION, ROL_ETIQUETA } from './formato';

interface Org {
  id: string;
  nombre: string;
  tipo: 'interna' | 'agencia';
}

/**
 * Crear una cuenta suelta (solo el administrador): organizacion, nombre y usuario; rol, area y encargado solo si aplican. La contrasena la genera el servidor y se muestra
 * UNA vez. Una cuenta de area (Consumibles, Mantenimiento...) es la forma normal: a esa cuenta se le envian las
 * referencias de su area. Si la organizacion es una agencia, el unico rol es `aduana` (D-28).
 */
export function FormularioCrearCuenta({ organizaciones, organizacionInicial }: { organizaciones: Org[]; organizacionInicial?: string }) {
  const internas = organizaciones.filter((o) => o.tipo === 'interna');
  const agencias = organizaciones.filter((o) => o.tipo === 'agencia');
  const [orgId, setOrgId] = useState(
    organizacionInicial && organizaciones.some((o) => o.id === organizacionInicial) ? organizacionInicial : (internas[0]?.id ?? agencias[0]?.id ?? ''),
  );
  const org = organizaciones.find((o) => o.id === orgId);
  const esAgencia = org?.tipo === 'agencia';
  const [rolElegido, setRolElegido] = useState<Rol>('solicitante');
  const rol: Rol = esAgencia ? 'aduana' : rolElegido;
  const areaObligatoria = exigeArea(rol, org?.tipo ?? 'interna');
  const [creada, setCreada] = useState<SecretoEntrega | null>(null);
  const [usuario, setUsuario] = useState('');

  // La cuenta recien creada reemplaza al formulario: asi no se puede enviar dos veces ni perder la contrasena.
  const accion = useCallback(async (previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> => {
    const r = await crearCuentaAccion(previo, datos);
    if (r.estado === 'ok' && r.secreto) setCreada(r.secreto);
    return r;
  }, []);

  if (creada) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-azul-700 text-white">
            <Check aria-hidden className="size-5" />
          </span>
          <h2 className="font-display text-xl font-extrabold text-tinta">Cuenta creada: {creada.nombre}</h2>
        </div>
        <CredencialesEntrega secreto={creada} />
        <div className="flex flex-wrap gap-3">
          <Link href={`/admin/usuarios/${creada.id}`} className={botonVariantes({ variante: 'primario' })}>
            Ver la cuenta
          </Link>
          <button type="button" onClick={() => { setCreada(null); setUsuario(''); }} className={botonVariantes({ variante: 'secundario' })}>
            Crear otra cuenta
          </button>
        </div>
      </div>
    );
  }

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
        Cada cuenta pertenece a una organización interna o a una agencia de aduana.
      </Aviso>
    );
  }

  return (
    <FormularioAccion
      accion={accion}
      enviar="Crear la cuenta"
      enviando="Creando…"
      className="space-y-6"
      secundario={
        <Link href="/admin/usuarios" className={botonVariantes({ variante: 'terciario' })}>
          Cancelar
        </Link>
      }
    >
      {(estado) => (
        <>
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

          <div className="grid gap-5 sm:grid-cols-2">
            <CampoFormulario etiqueta={esAgencia ? 'Nombre de la cuenta (ej. Agencia X)' : 'Nombre de la cuenta (ej. Área Consumibles)'} error={estado.errores?.nombre}>
              {(p) => <Campo {...p} name="nombre" autoComplete="off" required maxLength={200} />}
            </CampoFormulario>
            <CampoFormulario etiqueta="Usuario" ayuda="Con esto entra. Ej.: consumibles.essilorluxottica" error={estado.errores?.usuario}>
              {(p) => (
                <Campo
                  {...p}
                  name="usuario"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={40}
                  value={usuario}
                  onChange={(e) => setUsuario(normalizarUsuario(e.target.value))}
                />
              )}
            </CampoFormulario>
          </div>

          {esAgencia ? (
            // Una agencia solo tiene el rol de aduana (D-28): no hay nada que elegir.
            <input type="hidden" name="rol" value="aduana" />
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

          {areaObligatoria ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <CampoFormulario etiqueta="Área" ayuda="La cuenta es del área: ve en «Para mí» lo de esa área y recibe lo que le envíen." error={estado.errores?.area}>
                {(p) => (
                  <Seleccion {...p} name="area" defaultValue="" required>
                    <option value="">Elige el área…</option>
                    {AREAS.map((a) => (
                      <option key={a} value={a}>
                        {nombreDeArea(a)}
                      </option>
                    ))}
                  </Seleccion>
                )}
              </CampoFormulario>
              <CampoFormulario etiqueta="Encargado del área" ayuda="Opcional. Quién lleva hoy la cuenta." opcional error={estado.errores?.encargado}>
                {(p) => <Campo {...p} name="encargado" autoComplete="off" maxLength={80} />}
              </CampoFormulario>
            </div>
          ) : null}

          <p className="text-sm text-tinta-suave">Al crear la cuenta generamos una contraseña temporal y te la mostramos una vez para que se la entregues.</p>
        </>
      )}
    </FormularioAccion>
  );
}
