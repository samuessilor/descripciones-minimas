/**
 * Matriz rol x tipo de producto x campo, GENERADA desde `campos.ts` (SPEC 17.1, P-03): el resultado
 * real de `guardarCampo` (SQL, transacciones, politicas) debe coincidir con la regla pura de
 * `dominio/permisos.ts`. Incluye el caso negado y los campos ocultos por tipo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMPOS, TIPOS_PRODUCTO, esVisible, type CampoDef, type TipoProducto } from '@/dominio/campos';
import { puedeEscribirCampo, type Rol } from '@/dominio/permisos';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import type { Actor } from '@/server/politicas/actor';
import { asignarAAduana, nuevoEscenario, nuevaFicha, versionDe, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

function muestra(c: CampoDef, tipo: TipoProducto): unknown {
  switch (c.tipoDato) {
    case 'tipo_producto':
      return tipo; // el mismo valor: se prueba el permiso, no el cambio
    case 'area':
      return 'Instrumentos';
    case 'lista':
      if (c.opciones) return c.opciones[0]; // lista fija (tipo de empaque): Bidón, que ademas activa cantidad_empaque
      return c.catalogo === 'unidad_medida' ? 'Litros' : 'Líquido';
    case 'marca':
      return { texto: 'ACME' };
    case 'pais':
      return 'FR';
    case 'valor_unitario':
      return '10,5';
    case 'cantidad':
      return '2x3';
    case 'fecha_fabricacion':
      return { fecha: '2025-01-01' };
    case 'partida':
      return '8421.39.90.00';
    case 'clasificador':
      return { nombre: 'Ana Perez', organizacion: 'Agencia X' };
    case 'si_no':
      return 'NO'; // SI cerraria la clasificacion (H4)
    case 'fecha':
      return '2026-10-01';
    default:
      return `Texto de prueba para ${c.clave}`;
  }
}

const actoresPorRol = (): Array<[string, Actor, Rol]> => [
  ['admin', e.admin, 'admin'],
  ['solicitante', e.edward, 'solicitante'],
  ['aduana (agencia A, con la ficha asignada)', e.brian, 'aduana'],
  ['lector', e.lector, 'lector'],
];

describe.each(TIPOS_PRODUCTO)('matriz de escritura -- ficha de tipo %s', (tipo) => {
  for (const [nombre, , rol] of [
    ['admin', null, 'admin'],
    ['solicitante', null, 'solicitante'],
    ['aduana', null, 'aduana'],
    ['lector', null, 'lector'],
  ] as const) {
    it(`${nombre}: cada campo se acepta o se niega exactamente como dice la regla`, async () => {
      const actor = actoresPorRol().find(([, , r]) => r === rol)![1];
      const ficha = await nuevaFicha(e, { tipo });
      await asignarAAduana(e, ficha, e.brian);

      const discrepancias: string[] = [];
      let aceptados = 0;
      let negados = 0;
      for (const c of CAMPOS) {
        // fecha_solicitud se prueba aparte (depende de quien creo la ficha y de que sea borrador).
        // respuesta_area solo se escribe si la aduana hizo una solicitud: se prueba aparte (guardar-campo).
        if (c.clave === 'fecha_solicitud' || c.clave === 'codigo' || c.clave === 'respuesta_area') continue;

        let esperado: string;
        if (!esVisible(c, tipo) && c.clave !== 'tipo_producto') {
          esperado = 'VALIDACION';
        } else if (!c.escribible) {
          esperado = 'VALIDACION';
        } else {
          const r = puedeEscribirCampo(actor, c, { estado: 'EN_GESTION', archivada: false, creadaPor: e.edward.usuarioId });
          esperado = r.ok ? 'OK' : r.codigo;
        }

        let obtenido = 'OK';
        try {
          await guardarCampo(e.ctx(actor), {
            referenciaId: ficha,
            campo: c.clave,
            valor: muestra(c, tipo),
            versionEsperada: await versionDe(e.db, ficha, c.clave),
            motivo: 'prueba de matriz', // aisla el permiso de la regla de motivo sobre valor ajeno
          });
        } catch (err) {
          obtenido = err instanceof ErrorAccion ? err.codigo : `EXCEPCION:${String(err)}`;
        }
        if (obtenido === 'OK') aceptados++;
        else negados++;
        if (obtenido !== esperado) discrepancias.push(`${c.clave}: esperado ${esperado}, obtenido ${obtenido}`);
      }
      expect(discrepancias).toEqual([]);
      // El caso negado y el permitido ocurren de verdad (la prueba no es vacia).
      if (rol === 'lector') expect(aceptados).toBe(0);
      else expect(aceptados).toBeGreaterThan(0);
      expect(negados).toBeGreaterThan(0);
    });
  }
});

describe('fecha de solicitud (RV-32)', () => {
  it('el creador la corrige mientras la ficha es borrador; despues solo el admin', async () => {
    const ficha = await nuevaFicha(e);
    const g = async (actor: Actor, fecha: string) =>
      guardarCampo(e.ctx(actor), {
        referenciaId: ficha,
        campo: 'fecha_solicitud',
        valor: fecha,
        versionEsperada: await versionDe(e.db, ficha, 'fecha_solicitud'),
      });
    await expect(g(e.charles, '2026-10-02')).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    expect((await g(e.edward, '2026-10-02')).escrito).toBe(true);
    await asignarAAduana(e, ficha, e.brian);
    await expect(g(e.edward, '2026-10-03')).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(g(e.admin, '2026-10-03')).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO' }); // el valor es de Edward
    expect((await guardarCampo(e.ctx(e.admin), {
      referenciaId: ficha, campo: 'fecha_solicitud', valor: '2026-10-03', motivo: 'Corrijo la fecha', versionEsperada: await versionDe(e.db, ficha, 'fecha_solicitud'),
    })).escrito).toBe(true);
    await expect(g(e.admin, '2999-01-01')).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });
});
