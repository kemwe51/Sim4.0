const WORD_RE = /([A-Z])([+\-]?\d*\.?\d+)/g;

export function stripComments(line) {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/g, '');
}

export function parseBlock(rawLine, lineNumber) {
  const cleaned = stripComments(rawLine).trim().toUpperCase();
  if (!cleaned) {
    return { lineNumber, raw: rawLine, cleaned, words: [], errors: [] };
  }

  const compact = cleaned.replace(/\s+/g, '');
  const words = [];
  const errors = [];
  let cursor = 0;
  let match;

  while ((match = WORD_RE.exec(compact)) !== null) {
    if (match.index !== cursor) {
      errors.push(`Unexpected token near '${compact.slice(cursor, match.index)}'`);
    }
    cursor = WORD_RE.lastIndex;
    words.push({ letter: match[1], value: Number(match[2]), raw: match[0] });
  }

  if (cursor !== compact.length) {
    errors.push(`Cannot parse tail '${compact.slice(cursor)}'`);
  }

  return { lineNumber, raw: rawLine, cleaned, words, errors };
}

export function parseProgram(source) {
  return source.split(/\r?\n/).map((line, idx) => parseBlock(line, idx + 1));
}
