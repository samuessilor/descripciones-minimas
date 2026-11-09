import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { exigirActor } from '@/server/sesion';

export const metadata: Metadata = { title: 'Ayuda · Descripciones mínimas' };

function Paso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-borde-suave bg-superficie p-5 shadow-suave">
      <h2 className="mb-2 font-display text-lg font-extrabold text-tinta">{titulo}</h2>
      <div className="space-y-2 text-base text-tinta [&_li]:ml-5 [&_ul_li]:list-disc [&_ol_li]:list-decimal">{children}</div>
    </section>
  );
}

/** Manual básico: una pantalla, sin imágenes. Mismo contenido que `docs/MANUAL-BASICO.md`. */
export default async function Ayuda() {
  await exigirActor();
  return (
    <ContenedorLectura>
      <EncabezadoPagina titulo="Ayuda" descripcion="Cómo se usa, paso a paso. Una referencia es una hoja de vida que se llena entre varias personas." />
      <div className="space-y-4" data-testid="ayuda">
        <Paso titulo="1. Los dos colores">
          <ul>
            <li>
              <b>Verde</b>: completo o clasificado.
            </li>
            <li>
              <b>Amarillo</b>: falta algo, y siempre dice qué falta y de quién está pendiente.
            </li>
            <li>
              El recuadro de fondo amarillo muy pálido con la etiqueta <b>«Lo llena la aduana»</b> es lo que completa la agencia: partida, descripciones
              mínimas adicionales, restricciones y observaciones. Todo lo demás lo llena el área.
            </li>
          </ul>
        </Paso>
        <Paso titulo="2. Crear una referencia">
          <ol>
            <li>Pulsa «Nueva referencia».</li>
            <li>Escribe el código, el nombre y el tipo (Insumo, Repuesto, Equipo/Máquina, Accesorio o Montura).</li>
            <li>
              Elige el <b>área responsable</b> (Consumibles, Mantenimiento, Instrumentos o Marketing): la referencia es de esa área, aunque la crees desde
              otra. No depende del tipo: un repuesto puede ser de Consumibles.
            </li>
            <li>Se abre la ficha. Empieza de cero: no se importa nada del pasado.</li>
          </ol>
        </Paso>
        <Paso titulo="3. Llenar la ficha">
          <ul>
            <li>Tres secciones: Producto, Detalle y Especificaciones, más el bloque de la aduana.</li>
            <li>Se guarda solo al salir de cada campo. Al terminar, pulsa «Guardar y volver al listado».</li>
            <li>Si no tienes un dato, déjalo vacío y sigue: la sección queda en amarillo y otra persona lo puede completar.</li>
            <li>
              Si un dato no aplica al producto, márcalo: «No aplica» en aspecto físico o tipo de empaque, «No tiene marca», «El proveedor es el mismo
              fabricante». Cuenta como lleno. Si lo desmarcas o borras un valor, vuelve a quedar pendiente.
            </li>
            <li>
              «¿Requiere registro de importación (RIM)?»: si eliges «Sí», aparece «Cantidad» y hay que llenarla; con «No» no se pide.
            </li>
            <li>«Información adicional» es opcional: lo que el área quiera añadir.</li>
            <li>Nadie puede borrar lo que escribió otra persona: cada campo guarda su historial y se puede restaurar un valor anterior con su motivo.</li>
            <li>La foto es opcional.</li>
          </ul>
        </Paso>
        <Paso titulo="4. Dejar pendiente a otra persona">
          <p>Ejemplo: quien supervisa llena lo básico; Detalle le toca a una persona y Especificaciones a otra.</p>
          <ol>
            <li>En la sección amarilla pulsa «Dejar pendiente a…» (o «Enviar a…» arriba).</li>
            <li>Elige a la persona y marca qué parte le dejas: Producto, Detalle o Especificaciones.</li>
            <li>Si quieres, escribe un mensaje corto y pulsa «Enviar».</li>
            <li>A esa persona le aparece en la campana y en «Para mí», con el enlace directo a la ficha. No hay que escribir ningún correo.</li>
            <li>Repite con la otra persona y la otra parte. Cada sección amarilla dice «Pendiente de … · desde hace N días».</li>
          </ol>
          <p>
            Si nadie la tiene asignada, la sección es del área responsable: dice «Pendiente del área …» y la ven en «Para mí» todas las personas de esa
            área. Si la ficha no tiene área, dice «Sin responsable»: déjasela a quien deba llenarla.
          </p>
        </Paso>
        <Paso titulo="5. Cuando termino mi parte">
          <ul>
            <li>«Listo por mi parte» avisa a quien te la envió.</li>
            <li>O pásala a la siguiente persona con «Enviar a…», por ejemplo a la agencia de aduana.</li>
            <li>El panel «Siguiente paso», al final de la ficha, te dice qué sigue en cada caso.</li>
          </ul>
        </Paso>
        <Paso titulo="6. Resumen (vista general)">
          <ul>
            <li>Las cifras: clasificadas, abiertas, sin responsable y detenidas (5 o más días sin moverse).</li>
            <li>Qué espera cada persona y desde cuándo.</li>
            <li>
              Cada referencia abierta con sus cuatro partes y la columna «Quién falta», por ejemplo «Esperando a Edward (Detalle)». Lo urgente va primero.
            </li>
            <li>Las cerradas, con producto, partida y fecha. «Descargar Excel» baja toda la base.</li>
          </ul>
        </Paso>
        <Paso titulo="7. Para la agencia de aduana">
          <ul>
            <li>Solo ves las referencias que te enviaron.</li>
            <li>
              Completa el bloque «Lo llena la aduana»: <b>partida arancelaria</b> (los 10 dígitos; los puntos los pone la plataforma; si la partida tiene
              una restricción en el catálogo, se copia sola), <b>restricciones</b> y <b>observaciones</b>. Las dos últimas admiten «No aplica».
            </li>
            <li>
              En <b>descripciones mínimas adicionales</b> escribe lo que te falta saber del producto (por ejemplo «¿el motor es AC o DC? ¿amperaje?») o
              marca «No es necesario por ahora / no aplica». Si escribes algo, al área responsable le llega un pendiente «Responder» en la campana y en «Para mí», y te
              contesta en «Respuesta del área», debajo de tu solicitud. Mientras no responda, esa parte sigue en amarillo; si cambias la solicitud,
              vuelve a quedar pendiente.
            </li>
            <li>Si al área le llega una solicitud de la aduana, la responde en la zona de la aduana de la ficha, en «Respuesta del área».</li>
            <li>Cierra con «Clasificación finalizada = Sí»: la referencia pasa a verde y queda con su fecha.</li>
          </ul>
        </Paso>
        <Paso titulo="8. Cuentas: una por área y una por empresa de aduana">
          <ul>
            <li>
              Cada área (Consumibles, Mantenimiento, Instrumentos, Marketing) tiene una cuenta general que entra con su correo. Ve en «Para mí» las
              referencias de su área que tienen algo pendiente, aunque nadie se las haya enviado, y recibe las solicitudes de la aduana sobre ellas. El
              área se compromete a revisar «Para mí» y la campana a diario.
            </li>
            <li>El área de cada persona se elige de la lista en Administración › Usuarios (al invitar o al editar).</li>
            <li>
              Cada empresa de aduana es una organización de tipo agencia con una cuenta general, sin datos personales. Para una empresa nueva:
              Administración › Organizaciones › «Nueva organización» (tipo Agencia de aduana) › ábrela › «Invitar a esta agencia» con el correo general.
            </li>
            <li>
              Si cambian de proveedor de aduana: en Administración › Usuarios abre la cuenta de la agencia vieja y desactívala; antes de hacerlo te pide a
              quién pasar sus pendientes. Después desactiva la organización. Nada se borra: el historial conserva lo que escribió.
            </li>
          </ul>
        </Paso>
        <Paso titulo="¿Por qué no llega un correo?">
          <p>
            Los avisos viven dentro de la aplicación: la campana y «Para mí». Si algo es urgente, usa «Recordar» o escríbele por el medio de siempre; el
            enlace de la ficha sirve para eso.
          </p>
        </Paso>
      </div>
    </ContenedorLectura>
  );
}
