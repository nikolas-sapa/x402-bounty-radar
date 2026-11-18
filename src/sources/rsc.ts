// Extracts JSON objects out of Next.js App-Router pages. These sites stream
// their data as `self.__next_f.push([1,"<escaped string>"])` chunks inside a
// big <script> tag — no public JSON API, but the page IS the API.
//
// Strategy: collect every push payload's string literal, unescape it (so the
// embedded \" quotes become real JSON), concatenate into one corpus, then
// walk balanced-brace objects and JSON.parse the ones that contain `requiredKey`.
// Objects containing other objects are returned whole — callers pick fields.

// Match `self.__next_f.push([1,"<STRING>"])` — the payload is a JSON string
// literal, so extract it by finding the quote and walking to the unescaped
// closing quote (handles arbitrary escapes correctly).
function* pushPayloads(html: string): Generator<string> {
  const marker = "self.__next_f.push(";
  let i = 0;
  while (true) {
    const start = html.indexOf(marker, i);
    if (start === -1) return;
    const q = html.indexOf('"', start + marker.length);
    if (q === -1) return;
    let j = q + 1;
    for (; j < html.length; j++) {
      const ch = html[j];
      if (ch === "\\") j++; // skip escaped char
      else if (ch === '"') break;
    }
    yield html.slice(q, j + 1); // includes surrounding quotes
    i = j + 1;
  }
}

export function rscCorpus(html: string): string {
  let out = "";
  for (const lit of pushPayloads(html)) {
    try {
      out += JSON.parse(lit) as string;
    } catch {
      // malformed chunk — skip, partial corpus is fine
    }
  }
  return out;
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
  for (const span of balancedObjects(corpus)) {
    if (!span.includes(`"${requiredKey}"`)) continue;
    try {
      const obj = JSON.parse(span) as Record<string, unknown>;
      out.push(obj);
    } catch {
      // not a complete JSON object (e.g. RSC refs inside) — skip
    }
  }
  return out;
}
