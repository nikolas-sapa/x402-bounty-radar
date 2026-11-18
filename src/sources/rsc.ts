// Extracts JSON objects out of Next.js App-Router pages. These sites stream
// their data as `self.__next_f.push([1,"<escaped string>"])` chunks inside a
// big <script> tag — no public JSON API, but the page IS the API.
//
// Strategy: collect every push payload's string literal, unescape it (so the
// embedded \" quotes become real JSON), concatenate into one corpus, then
// walk balanced-brace objects and JSON.parse the ones that contain `requiredKey`.
// Objects containing other objects are returned whole — callers pick fields.

// Match `self.__next_f.push([<id>,"<STRING>"])` — the payload is a JSON string
// literal, so extract it by finding the quote and walking to the unescaped
// closing quote (handles arbitrary escapes correctly). Yields the row id too:
// continuation chunks for one row can interleave with other rows, so the
// corpus must be assembled per id, not in document order.
function* pushPayloads(html: string): Generator<{ id: number; lit: string }> {
  const marker = "self.__next_f.push(";
  let i = 0;
  while (true) {
    const start = html.indexOf(marker, i);
    if (start === -1) return;
    const q = html.indexOf('"', start + marker.length);
    if (q === -1) return;
    const idMatch = html.slice(start + marker.length, q).match(/\[\s*(\d+)\s*,\s*$/);
    let j = q + 1;
    for (; j < html.length; j++) {
      const ch = html[j];
      if (ch === "\\") j++; // skip escaped char
      else if (ch === '"') break;
    }
    yield { id: idMatch ? Number(idMatch[1]) : 0, lit: html.slice(q, j + 1) }; // lit includes surrounding quotes
    i = j + 1;
  }
}

export function rscCorpus(html: string): string {
  const rows = new Map<number, string>();
  for (const { id, lit } of pushPayloads(html)) {
    try {
      rows.set(id, (rows.get(id) ?? "") + (JSON.parse(lit) as string));
    } catch {
      // malformed chunk — skip, partial corpus is fine
    }
  }
  return [...rows.values()].join("");
}

// Every top-level {...} span in the corpus, in order.
function* balancedObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue; // stray brace in page copy — never go negative
      depth--;
      if (depth === 0 && start !== -1) {
        yield text.slice(start, i + 1);
        start = -1;
      }
    }
  }
}

// All parseable JSON objects in the page's RSC payload that contain the key.
// Returns raw objects — the caller validates fields.
export function extractRscObjects(html: string, requiredKey: string): Record<string, unknown>[] {
  const corpus = rscCorpus(html);
  if (!corpus.includes(`"${requiredKey}"`)) return [];
  const out: Record<string, unknown>[] = [];
  // A top-level span that fails JSON.parse (one RSC ref/undefined inside)
  // shouldn't discard every valid object nested in it — retry inner spans.
  const queue = [...balancedObjects(corpus)];
  for (let i = 0; i < queue.length && i < 20_000; i++) {
    const span = queue[i];
    if (!span.includes(`"${requiredKey}"`)) continue;
    try {
      out.push(JSON.parse(span) as Record<string, unknown>);
    } catch {
      for (const inner of balancedObjects(span.slice(1, -1))) queue.push(inner);
    }
  }
  return out;
}
