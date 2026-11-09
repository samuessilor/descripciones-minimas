/**
 * Redireccion post-login (13.1, CA-18): el parametro `siguiente` solo admite rutas internas
 * (empieza por `/` y no por `//`). Cualquier otra cosa se ignora y se vuelve al inicio.
 */
export function siguienteSeguro(valor: unknown, porDefecto = '/'): string {
  if (typeof valor !== 'string' || valor === '') return porDefecto;
  if (!valor.startsWith('/') || valor.startsWith('//')) return porDefecto;
  // Barras invertidas y caracteres de control: los navegadores las normalizan a `/` o las ignoran.
  if (/[\u0000-\u001f\u007f\\]/.test(valor)) return porDefecto;
  try {
    const u = new URL(valor, 'http://interno.invalid');
    if (u.origin !== 'http://interno.invalid') return porDefecto;
    const destino = `${u.pathname}${u.search}${u.hash}`;
    // WHATWG URL colapsa los segmentos `.` y `..`: `/.//x` queda `//x`, que el navegador lee como otro
    // sitio. Se valida el RESULTADO, no solo la entrada.
    if (destino.startsWith('//') || !destino.startsWith('/')) return porDefecto;
    return destino;
  } catch {
    return porDefecto;
  }
}
