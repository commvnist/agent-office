// The renderer's pixel rules, in one place (docs/visual-consistency.md): art space is integers, screen space is whole device pixels.
let D = 1; // device pixels per CSS pixel, set by main.ts whenever the renderer resolution changes

export const setDpr = (d: number) => { D = d > 0 ? d : 1; };
export const getDpr = () => D;
/** Art-space position: always a whole art pixel. */
export const art = (n: number) => Math.round(n);
/** Screen-space (CSS px) position snapped to a whole device pixel. */
export const dev = (n: number, d = D) => Math.round(n * d) / d;
/** The one way sprites/graphics are placed in art space. */
export const place = <O extends { position: { set(x: number, y: number): unknown } }>(o: O, x: number, y: number): O => { o.position.set(art(x), art(y)); return o; };
