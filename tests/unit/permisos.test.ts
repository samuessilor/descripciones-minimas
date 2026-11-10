import { describe, expect, it } from 'vitest';
import { getCampo } from '@/dominio/campos';
import {
  ROLES,
  alcanceExcel,
  autorVisible,
  comentarioVisible,
  esGestor,
  fichaVisiblePara,
  motivoVisible,
  puede,
  puedeAsignarRol,
  puedeEscribirCampo,
  puedeTocarCuenta,
  validarRolOrganizacion,
  visibilidadesComentarioPermitidas,
  type AccesoAgencia,
  type ActorLike,
  type Rol,
} from '@/dominio/permisos';

const actor = (rol: Rol, extra: Partial<ActorLike> = {}): ActorLike => ({
  usuarioId: `u-${rol}`,
  rol,
  organizacionId: rol === 'aduana' ? 'org-agencia-a' : 'org-interna',
  organizacionTipo: rol === 'aduana' ? 'agencia' : 'interna',
  ...extra,
});

describe('regla rol x tipo de organizacion (D-28, CA-19)', () => {
  it('una agencia solo admite el rol aduana', () => {
    expect(validarRolOrganizacion('aduana', 'agencia').ok).toBe(true);
    for (const rol of ['admin', 'supervisor', 'solicitante', 'lector'] as const) {
      const r = validarRolOrganizacion(rol, 'agencia');
      expect(r.ok, rol).toBe(false);
    }
  });

  it('una organizacion interna admite todos los roles (PA-16 deja abierto aduana interno)', () => {
    for (const rol of ROLES) expect(validarRolOrganizacion(rol, 'interna').ok, rol).toBe(true);
  });
});

describe('matriz de permisos 3.3 (rol x accion)', () => {
  const casos: Array<[Parameters<typeof puede>[1], Record<Rol, boolean>, Parameters<typeof puede>[2]?]> = [
    ['ver_listado', { admin: true, supervisor: true, solicitante: true, aduana: true, lector: true }],
    ['crear_referencia', { admin: true, supervisor: true, solicitante: true, aduana: false, lector: false }],
    ['escribir_grupo_cliente', { admin: true, supervisor: true, solicitante: true, aduana: false, lector: false }],
    ['escribir_grupo_aduana', { admin: true, supervisor: true, solicitante: false, aduana: true, lector: false }],
    ['marcar_clasificada', { admin: true, supervisor: true, solicitante: false, aduana: true, lector: false }],
    ['enviar_a', { admin: true, supervisor: true, solicitante: true, aduana: true, lector: false }],
    ['adjuntar_foto', { admin: true, supervisor: true, solicitante: true, aduana: false, lector: false }],
    ['reabrir', { admin: true, supervisor: true, solicitante: false, aduana: true, lector: false }],
    ['solicitar_reapertura', { admin: true, supervisor: true, solicitante: true, aduana: false, lector: false }],
    ['desarchivar', { admin: true, supervisor: true, solicitante: false, aduana: false, lector: false }],
    ['administrar', { admin: true, supervisor: false, solicitante: false, aduana: false, lector: false }],
    ['supervisar', { admin: true, supervisor: true, solicitante: false, aduana: false, lector: false }],
    ['comentar', { admin: true, supervisor: true, solicitante: true, aduana: true, lector: false }],
    ['descargar_excel', { admin: true, supervisor: true, solicitante: true, aduana: true, lector: true }],
  ];

  for (const [accion, esperado, ctx] of casos) {
    for (const rol of ROLES) {
      it(`${accion}: ${rol} -> ${esperado[rol]}`, () => {
        expect(puede(actor(rol), accion, ctx)).toBe(esperado[rol]);
      });
    }
  }

  it('recordar: remitente, admin, supervisora y lector (RV-35)', () => {
    expect(puede(actor('admin'), 'recordar', { esRemitente: false })).toBe(true);
    expect(puede(actor('supervisor'), 'recordar', { esRemitente: false })).toBe(true);
    expect(puede(actor('lector'), 'recordar', { esRemitente: false })).toBe(true);
    expect(puede(actor('solicitante'), 'recordar', { esRemitente: true })).toBe(true);
    expect(puede(actor('solicitante'), 'recordar', { esRemitente: false })).toBe(false);
    expect(puede(actor('aduana'), 'recordar', { esRemitente: true })).toBe(true);
    expect(puede(actor('aduana'), 'recordar', { esRemitente: false })).toBe(false);
  });

  it('reasignar: admin, supervisora o el remitente de esa asignacion; nunca el lector', () => {
    expect(puede(actor('admin'), 'reasignar', { esRemitente: false })).toBe(true);
    expect(puede(actor('supervisor'), 'reasignar', { esRemitente: false })).toBe(true);
    expect(puede(actor('solicitante'), 'reasignar', { esRemitente: true })).toBe(true);
    expect(puede(actor('solicitante'), 'reasignar', { esRemitente: false })).toBe(false);
    expect(puede(actor('lector'), 'reasignar', { esRemitente: true })).toBe(false);
  });

  it('archivar: admin y supervisora; el solicitante solo si es el autor de un borrador sin enviar', () => {
    expect(puede(actor('admin'), 'archivar', {})).toBe(true);
    expect(puede(actor('supervisor'), 'archivar', {})).toBe(true);
    expect(puede(actor('solicitante'), 'archivar', { esCreador: true, esBorradorSinEnviar: true })).toBe(true);
    expect(puede(actor('solicitante'), 'archivar', { esCreador: true, esBorradorSinEnviar: false })).toBe(false);
    expect(puede(actor('solicitante'), 'archivar', { esCreador: false, esBorradorSinEnviar: true })).toBe(false);
    expect(puede(actor('aduana'), 'archivar', { esCreador: true, esBorradorSinEnviar: true })).toBe(false);
  });

  it('corregir codigo: admin siempre; el creador mientras no este CLASIFICADA (RV-34)', () => {
    expect(puede(actor('admin'), 'corregir_codigo', { estadoFicha: 'CLASIFICADA' })).toBe(true);
    expect(puede(actor('supervisor'), 'corregir_codigo', { estadoFicha: 'CLASIFICADA' })).toBe(true);
    expect(puede(actor('solicitante'), 'corregir_codigo', { esCreador: true, estadoFicha: 'EN_GESTION' })).toBe(true);
    expect(puede(actor('solicitante'), 'corregir_codigo', { esCreador: true, estadoFicha: 'CLASIFICADA' })).toBe(false);
    expect(puede(actor('solicitante'), 'corregir_codigo', { esCreador: false, estadoFicha: 'BORRADOR' })).toBe(false);
    expect(puede(actor('aduana'), 'corregir_codigo', { esCreador: true, estadoFicha: 'BORRADOR' })).toBe(false);
  });

  it('adjuntar foto no se permite en ficha CLASIFICADA', () => {
    expect(puede(actor('solicitante'), 'adjuntar_foto', { estadoFicha: 'CLASIFICADA' })).toBe(false);
    expect(puede(actor('admin'), 'adjuntar_foto', { estadoFicha: 'CLASIFICADA' })).toBe(false);
  });

  it('comentarios: la aduana solo escribe "para todos"; los internos eligen (RV-29)', () => {
    expect(visibilidadesComentarioPermitidas('aduana')).toEqual(['todos']);
    expect(visibilidadesComentarioPermitidas('solicitante')).toEqual(['interno', 'todos']);
    expect(visibilidadesComentarioPermitidas('lector')).toEqual([]);
  });

  it('excel: admin, supervisora y solicitante todo; aduana y lector solo lo que ven', () => {
    expect(alcanceExcel('admin')).toBe('todo');
    expect(alcanceExcel('supervisor')).toBe('todo');
    expect(alcanceExcel('solicitante')).toBe('todo');
    expect(alcanceExcel('aduana')).toBe('visible');
    expect(alcanceExcel('lector')).toBe('visible');
  });
});

describe('guardas por objetivo de la supervisora general', () => {
  it('solo el administrador da el rol de administrador o de supervisora', () => {
    for (const nuevo of ROLES) expect(puedeAsignarRol(actor('admin'), nuevo), nuevo).toBe(true);
    expect(puedeAsignarRol(actor('supervisor'), 'admin')).toBe(false);
    expect(puedeAsignarRol(actor('supervisor'), 'supervisor')).toBe(false);
    expect(puedeAsignarRol(actor('supervisor'), 'solicitante')).toBe(true);
    expect(puedeAsignarRol(actor('solicitante'), 'admin')).toBe(false);
  });

  it('solo el administrador toca cuentas de administrador o de supervisora; la supervisora toca el resto', () => {
    for (const rol of ROLES) expect(puedeTocarCuenta(actor('admin'), rol), rol).toBe(true);
    expect(puedeTocarCuenta(actor('supervisor'), 'admin')).toBe(false);
    expect(puedeTocarCuenta(actor('supervisor'), 'supervisor')).toBe(false);
    for (const rol of ['solicitante', 'aduana', 'lector'] as const) expect(puedeTocarCuenta(actor('supervisor'), rol), rol).toBe(true);
  });

  it('`administrar` (parametros y claves) es solo del administrador; `supervisar` es de los dos', () => {
    expect(ROLES.filter((rol) => puede(actor(rol), 'administrar'))).toEqual(['admin']);
    expect(ROLES.filter((rol) => puede(actor(rol), 'supervisar'))).toEqual(['admin', 'supervisor']);
  });

  it('esGestor: administrador y supervisora, nadie mas', () => {
    expect(ROLES.filter(esGestor)).toEqual(['admin', 'supervisor']);
  });

  it('la supervisora escribe en ambos grupos y fija la fecha de solicitud de una ficha ajena', () => {
    const f = { estado: 'EN_GESTION' as const, archivada: false, creadaPor: 'u-solicitante' };
    expect(puedeEscribirCampo(actor('supervisor'), getCampo('nombre_producto')!, f).ok).toBe(true);
    expect(puedeEscribirCampo(actor('supervisor'), 'fecha_solicitud', f).ok).toBe(true);
  });
});

describe('escritura por campo y grupo (9.2, D-02)', () => {
  const ficha = { estado: 'EN_GESTION' as const, archivada: false, creadaPor: 'u-solicitante' };

  it('el solicitante escribe el grupo cliente y no el de la aduana', () => {
    expect(puedeEscribirCampo(actor('solicitante'), getCampo('uso')!, ficha)).toEqual({ ok: true });
    expect(puedeEscribirCampo(actor('solicitante'), getCampo('partida_arancelaria')!, ficha)).toEqual({
      ok: false,
      codigo: 'SIN_PERMISO',
    });
  });

  it('la aduana escribe el grupo aduana y es solo lectura sobre el del cliente', () => {
    expect(puedeEscribirCampo(actor('aduana'), getCampo('partida_arancelaria')!, ficha)).toEqual({ ok: true });
    expect(puedeEscribirCampo(actor('aduana'), getCampo('uso')!, ficha)).toEqual({ ok: false, codigo: 'SIN_PERMISO' });
  });

  it('el administrador escribe ambos grupos', () => {
    expect(puedeEscribirCampo(actor('admin'), getCampo('uso')!, ficha).ok).toBe(true);
    expect(puedeEscribirCampo(actor('admin'), getCampo('restricciones')!, ficha).ok).toBe(true);
  });

  it('el lector no escribe nada', () => {
    expect(puedeEscribirCampo(actor('lector'), getCampo('uso')!, ficha)).toEqual({ ok: false, codigo: 'SIN_PERMISO' });
  });

  it('una ficha CLASIFICADA o archivada es solo lectura (FICHA_CERRADA) para quien podria escribir', () => {
    expect(puedeEscribirCampo(actor('solicitante'), getCampo('uso')!, { ...ficha, estado: 'CLASIFICADA' })).toEqual({
      ok: false,
      codigo: 'FICHA_CERRADA',
    });
    expect(puedeEscribirCampo(actor('solicitante'), getCampo('uso')!, { ...ficha, archivada: true })).toEqual({
      ok: false,
      codigo: 'FICHA_CERRADA',
    });
    // quien nunca podria escribir recibe SIN_PERMISO, no FICHA_CERRADA
    expect(puedeEscribirCampo(actor('lector'), getCampo('uso')!, { ...ficha, estado: 'CLASIFICADA' })).toEqual({
      ok: false,
      codigo: 'SIN_PERMISO',
    });
  });

  it('fecha_solicitud: el creador mientras sea BORRADOR y el admin; nadie mas (RV-32)', () => {
    const campo = getCampo('fecha_solicitud')!;
    const borrador = { ...ficha, estado: 'BORRADOR' as const };
    expect(puedeEscribirCampo(actor('solicitante'), campo, borrador).ok).toBe(true);
    expect(puedeEscribirCampo(actor('solicitante'), campo, ficha).ok).toBe(false);
    expect(puedeEscribirCampo(actor('solicitante', { usuarioId: 'otro' }), campo, borrador).ok).toBe(false);
    expect(puedeEscribirCampo(actor('admin'), campo, ficha).ok).toBe(true);
  });

  it('los campos calculados no se escriben nunca', () => {
    expect(puedeEscribirCampo(actor('admin'), getCampo('dias_gestion')!, ficha).ok).toBe(false);
    expect(puedeEscribirCampo(actor('admin'), getCampo('adjuntos')!, ficha).ok).toBe(false);
  });

  it('las descripciones minimas las escriben la aduana y el admin; una clave fuera del catalogo no se escribe', () => {
    expect(puedeEscribirCampo(actor('aduana'), 'descripciones_minimas', ficha).ok).toBe(true);
    expect(puedeEscribirCampo(actor('admin'), 'descripciones_minimas', ficha).ok).toBe(true);
    expect(puedeEscribirCampo(actor('solicitante'), 'descripciones_minimas', ficha).ok).toBe(false);
    expect(puedeEscribirCampo(actor('lector'), 'descripciones_minimas', ficha).ok).toBe(false);
    expect(puedeEscribirCampo(actor('admin'), 'dm:3f1c2e9a-0000-4000-8000-000000000001', ficha).ok).toBe(false);
  });
});

describe('visibilidad de fichas para la aduana (8.3 regla 10, RV-28, CA-19, CA-20)', () => {
  const ahora = new Date('2026-10-21T15:00:00Z');
  const ficha = { archivada: false };
  const acceso = (p: Partial<AccesoAgencia>): AccesoAgencia => ({
    organizacionId: 'org-agencia-a',
    estado: 'pendiente',
    accesoHasta: null,
    ...p,
  });

  it('los roles internos ven todas las fichas', () => {
    for (const rol of ['admin', 'solicitante', 'lector'] as const) {
      expect(fichaVisiblePara(actor(rol), ficha, [], ahora), rol).toBe(true);
    }
  });

  it('la aduana ve una ficha con asignacion activa hacia su organizacion', () => {
    expect(fichaVisiblePara(actor('aduana'), ficha, [acceso({ estado: 'pendiente' })], ahora)).toBe(true);
    expect(fichaVisiblePara(actor('aduana'), ficha, [acceso({ estado: 'en_curso' })], ahora)).toBe(true);
  });

  it('la aduana no ve fichas sin asignacion o asignadas a otra agencia (404)', () => {
    expect(fichaVisiblePara(actor('aduana'), ficha, [], ahora)).toBe(false);
    expect(
      fichaVisiblePara(actor('aduana'), ficha, [acceso({ organizacionId: 'org-agencia-b' })], ahora),
    ).toBe(false);
  });

  it('una asignacion terminada conserva el acceso solo hasta acceso_hasta', () => {
    const vigente = acceso({ estado: 'hecha', accesoHasta: new Date('2026-11-20T00:00:00Z') });
    const vencido = acceso({ estado: 'hecha', accesoHasta: new Date('2026-10-20T00:00:00Z') });
    const sinFecha = acceso({ estado: 'hecha', accesoHasta: null });
    expect(fichaVisiblePara(actor('aduana'), ficha, [vigente], ahora)).toBe(true);
    expect(fichaVisiblePara(actor('aduana'), ficha, [vencido], ahora)).toBe(false);
    expect(fichaVisiblePara(actor('aduana'), ficha, [sinFecha], ahora)).toBe(false);
    expect(fichaVisiblePara(actor('aduana'), ficha, [acceso({ estado: 'reasignada', accesoHasta: vigente.accesoHasta })], ahora)).toBe(true);
  });

  it('una asignacion cancelada no da acceso', () => {
    expect(fichaVisiblePara(actor('aduana'), ficha, [acceso({ estado: 'cancelada' })], ahora)).toBe(false);
  });

  it('la aduana no ve fichas archivadas', () => {
    expect(fichaVisiblePara(actor('aduana'), { archivada: true }, [acceso({})], ahora)).toBe(false);
  });
});

describe('ocultamiento entre agencias y a la aduana (A5, RV-29, PA-38)', () => {
  const agenciaA = actor('aduana');
  const interno = { organizacionId: 'org-interna', organizacionTipo: 'interna' as const };
  const agenciaB = { organizacionId: 'org-agencia-b', organizacionTipo: 'agencia' as const };
  const mismaAgencia = { organizacionId: 'org-agencia-a', organizacionTipo: 'agencia' as const };

  it('un usuario de agencia ve "Otra agencia" para autores de otra agencia, y nombres internos o propios', () => {
    expect(autorVisible(agenciaA, agenciaB)).toBe('otra_agencia');
    expect(autorVisible(agenciaA, interno)).toBe('nombre');
    expect(autorVisible(agenciaA, mismaAgencia)).toBe('nombre');
  });

  it('los internos ven todos los nombres', () => {
    expect(autorVisible(actor('admin'), agenciaB)).toBe('nombre');
    expect(autorVisible(actor('lector'), mismaAgencia)).toBe('nombre');
  });

  it('el motivo de un reemplazo interno (o de otra agencia) no llega a la aduana', () => {
    expect(motivoVisible(agenciaA, interno)).toBe(false);
    expect(motivoVisible(agenciaA, agenciaB)).toBe(false);
    expect(motivoVisible(agenciaA, mismaAgencia)).toBe(true);
    expect(motivoVisible(actor('admin'), interno)).toBe(true);
    expect(motivoVisible(actor('solicitante'), agenciaB)).toBe(true);
  });

  it('un comentario interno solo lo ven usuarios de organizacion interna', () => {
    expect(comentarioVisible(agenciaA, 'interno')).toBe(false);
    expect(comentarioVisible(agenciaA, 'todos')).toBe(true);
    expect(comentarioVisible(actor('solicitante'), 'interno')).toBe(true);
    expect(comentarioVisible(actor('lector'), 'todos')).toBe(true);
  });
});
