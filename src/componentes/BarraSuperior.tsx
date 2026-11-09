import Link from 'next/link';
import { Logo } from './Logo';
import { MenuUsuario, type UsuarioMenu } from './MenuUsuario';
import { BuscadorLupa } from './slots/BuscadorLupa';
import { CampanaNotificaciones } from './slots/CampanaNotificaciones';
import { cuentasDemo, sinLogin } from '@/server/cuentas-demo';

/**
 * Barra superior fija (10.1): logo · buscador (lupa) · campana · menu de usuario. Azul profundo, ancho
 * completo, 56 px. Las dos piezas del medio son SLOTS de otras areas (`slots/`): este archivo solo las
 * coloca. Todo lo que viva aqui esta sobre fondo OSCURO: la clase `superficie-oscura` ya da el foco
 * blanco con anillo doble; los botones de icono usan `<Boton variante="fantasma-claro" tamano="icono">`.
 */
export function BarraSuperior({ usuario }: { usuario: UsuarioMenu }) {
  return (
    <header className="superficie-oscura sticky top-0 z-10 h-[var(--alto-barra-superior)] border-b border-white/10 bg-azul-900 text-white shadow-[0_1px_0_rgb(4_20_51/0.4)]">
      <div className="flex h-full items-center gap-2 px-3 sm:gap-4 sm:px-5">
        <Link
          href="/"
          aria-label="Descripciones mínimas, ir al inicio"
          className="group flex shrink-0 items-center gap-4 rounded-md py-2 pr-1"
        >
          <span className="max-sm:hidden">
            <Logo alto={22} />
          </span>
          <span className="sm:hidden">
            <Logo alto={15} />
          </span>
          <span aria-hidden className="hidden h-6 w-px bg-white/25 lg:block" />
          <span aria-hidden className="hidden font-display text-[0.9375rem] font-bold tracking-tight text-white/90 lg:block">
            Descripciones mínimas
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:justify-center lg:px-6">
          <BuscadorLupa />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <CampanaNotificaciones />
          <MenuUsuario usuario={usuario} cuentasDemo={sinLogin() ? cuentasDemo() : undefined} />
        </div>
      </div>
    </header>
  );
}
