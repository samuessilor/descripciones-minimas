'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { crearAgenciaAccion, type EstadoAdmin, type SecretoEntrega } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { botonVariantes } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Campo } from '@/componentes/ui/input';
import { normalizarUsuario, usuarioSugeridoAgencia } from '@/dominio/credenciales';
import { FormularioAccion } from './acciones';
import { CredencialesEntrega } from './CredencialesEntrega';

interface Creada {
  cuentaId: string;
  nombre: string;
  usuario: string;
  secreto: SecretoEntrega | null;
}

/**
 * «Nueva agencia»: el nombre de la empresa y, si se quiere, el usuario (se sugiere solo). Crea la organizacion y su unica
 * cuenta de una vez. Si lo hace el administrador se muestra la clave una vez; si lo hace la supervisora no la ve: la cuenta
 * nace con su clave y el administrador la ve y la entrega desde la ficha de la cuenta.
 */
export function FormularioNuevaAgencia() {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  // Mientras no lo toque, el usuario sigue al nombre; en cuanto lo edita a mano deja de cambiarse solo.
  const [usuarioEditado, setUsuarioEditado] = useState(false);
  const [creada, setCreada] = useState<Creada | null>(null);

  const accion = useCallback(async (previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> => {
    const r = await crearAgenciaAccion(previo, datos);
    if (r.estado === 'ok') {
      const cuenta = r.secreto ?? r.pendiente;
      if (cuenta) setCreada({ cuentaId: cuenta.id, nombre: cuenta.nombre, usuario: cuenta.usuario, secreto: r.secreto ?? null });
    }
    return r;
  }, []);

  if (creada) {
    return (
      <div className="space-y-5" data-testid="agencia-creada">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-azul-700 text-white">
            <Check aria-hidden className="size-5" />
          </span>
          <h3 className="font-display text-xl font-extrabold text-tinta">Agencia creada: {creada.nombre}</h3>
        </div>
        {creada.secreto ? (
          <CredencialesEntrega secreto={creada.secreto} />
        ) : (
          <Aviso tipo="info" titulo="Cuenta lista: el administrador entrega la contraseña">
            Creamos la cuenta <span className="font-mono font-bold">{creada.usuario}</span> con su contraseña, que solo ve el administrador. Le avisamos: abre la
            cuenta, ve el usuario y la contraseña y se las entrega a la agencia.
          </Aviso>
        )}
        <div className="flex flex-wrap gap-3">
          <Link href={`/admin/usuarios/${creada.cuentaId}`} className={botonVariantes({ variante: 'primario' })}>
            Ver la cuenta
          </Link>
          <button
            type="button"
            className={botonVariantes({ variante: 'secundario' })}
            onClick={() => {
              setCreada(null);
              setNombre('');
              setUsuario('');
              setUsuarioEditado(false);
            }}
          >
            Crear otra agencia
          </button>
        </div>
      </div>
    );
  }

  return (
    <FormularioAccion accion={accion} enviar="Crear agencia" enviando="Creando…" className="space-y-5">
      {(estado) => (
        <div className="grid gap-5 md:grid-cols-2 md:items-start">
          <CampoFormulario etiqueta="Nombre de la empresa" ayuda="Ejemplo: Agencia Magnum. Es también el nombre de su cuenta." error={estado.errores?.nombre}>
            {(p) => (
              <Campo
                {...p}
                name="nombre"
                autoComplete="off"
                required
                maxLength={120}
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value);
                  if (!usuarioEditado) setUsuario(e.target.value.trim() ? usuarioSugeridoAgencia(e.target.value) : '');
                }}
              />
            )}
          </CampoFormulario>
          <CampoFormulario etiqueta="Usuario" ayuda="Con esto entra la agencia. Lo sugerimos a partir del nombre; puedes cambiarlo." opcional error={estado.errores?.usuario}>
            {(p) => (
              <Campo
                {...p}
                name="usuario"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
                value={usuario}
                onChange={(e) => {
                  setUsuario(normalizarUsuario(e.target.value));
                  setUsuarioEditado(true);
                }}
              />
            )}
          </CampoFormulario>
        </div>
      )}
    </FormularioAccion>
  );
}
