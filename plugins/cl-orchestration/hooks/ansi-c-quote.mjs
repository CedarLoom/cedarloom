// The value of an ANSI-C quoted string ($'...'), as bash and zsh read it. bash decodes the escapes listed in
// https://www.gnu.org/software/bash/manual/html_node/ANSI_002dC-Quoting.html, keeps the backslash of any other and ends the value
// at a NUL. zsh decodes them as its print builtin does (https://zsh.sourceforge.io/Doc/Release/Shell-Builtin-Commands.html#index-print):
// \c and any other unknown escape stand for the plain character, \C and \M (or \C- and \M-) make the character after them, an escape
// too, a control or meta character, and \x, \u and \U without digits are a NUL. zsh keeps a NUL in the value: a builtin reads the
// whole word, a program only the word up to it.
const ESCAPES = new Map(Object.entries({ a: 7, b: 8, e: 27, E: 27, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63 }));
const DIGITS = { 8: /[0-7]{1,3}/y, 16: /[\da-f]{1,2}/iy, u: /[\da-f]{1,4}/iy, U: /[\da-f]{1,8}/iy };
const LITERAL = /[^\\]+/y;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// bash's control character of x: its code with the upper bits cleared, ? for DEL.
const control = (x) => (x === '?' ? 127 : x.toUpperCase().charCodeAt(0) & 31);
// A code point as UTF-8, an invalid one as the replacement character.
const utf8 = (point) => [...encoder.encode(String.fromCodePoint(point <= 0x10ffff ? point : 0xfffd))];

// start: the index after $'. end: the index of the closing quote, which a backslash escapes, or the text's length without one.
// mode: 'bash' (current bash), 'bash3' (bash 3.2, macOS's /bin/bash) or 'zsh'.
export function ansiC(text, start, mode = 'bash') {
  const zsh = mode === 'zsh';
  let end = start;
  while (end < text.length && text[end] !== "'") end += text[end] === '\\' ? 2 : 1;
  end = Math.min(end, text.length);
  const body = text.slice(start, end);
  const bytes = [];
  // zsh's \C and \M wait for the next character.
  let ctrl = false, meta = false;
  const put = (...unit) => {
    if (unit.length && (ctrl || meta)) {
      if (ctrl) unit[0] = unit[0] === 63 ? 127 : unit[0] & 0x9f;
      if (meta) unit[0] |= 0x80;
      ctrl = meta = false;
    }
    bytes.push(...unit);
  };
  // The digits of a numeric escape at i, or null where none follows.
  const digits = (i, kind) => {
    const pattern = DIGITS[kind];
    pattern.lastIndex = i;
    return pattern.exec(body)?.[0] ?? null;
  };
  for (let i = 0; i < body.length; ) {
    LITERAL.lastIndex = i;
    let literal = LITERAL.exec(body)?.[0];
    if (literal) {
      // A pending \C or \M takes only the first character.
      if (ctrl || meta) literal = String.fromCodePoint(literal.codePointAt(0));
      put(...encoder.encode(literal));
      i += literal.length;
      continue;
    }
    const c = body[i + 1];
    i += 2;
    if (c === undefined) put(92);
    else if (ESCAPES.has(c)) put(ESCAPES.get(c));
    else if (/[0-7]/.test(c)) {
      const run = digits(i - 1, 8);
      put(parseInt(run, 8) & 0xff);
      i += run.length - 1;
    } else if (c === 'x' || c === 'u' || c === 'U') {
      const run = digits(i, c === 'x' ? 16 : c);
      if (run === null) put(...(zsh ? [0] : [92, c.charCodeAt(0)]));
      else {
        i += run.length;
        put(...(c === 'x' ? [parseInt(run, 16)] : utf8(parseInt(run, 16))));
      }
    } else if (c === 'c' && !zsh && i < body.length) {
      // Current bash reads \c\\ as the control character of one backslash; bash 3.2 takes one character, so the second
      // backslash starts an escape of its own.
      const x = body[i++];
      if (mode === 'bash' && x === '\\' && body[i] === '\\') i++;
      put(control(x));
    } else if ((c === 'C' || c === 'M') && zsh) {
      if (body[i] === '-') i++;
      if (c === 'C') ctrl = true;
      else meta = true;
    } else put(...(zsh ? [] : [92]), ...encoder.encode(c));
  }
  const nul = bytes.indexOf(0);
  return { value: decoder.decode(new Uint8Array(zsh || nul < 0 ? bytes : bytes.slice(0, nul))), end };
}
