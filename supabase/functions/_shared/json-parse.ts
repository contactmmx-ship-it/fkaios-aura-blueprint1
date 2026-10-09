// Safe JSON parse recovery for common LLM formatting errors: trailing commas
// and unquoted object keys. It only edits syntax outside quoted strings; all
// other malformed output remains a hard failure instead of being guessed.
export function parseJSONCandidate(candidate: string): unknown {
  try { return JSON.parse(candidate); }
  catch (originalError) {
    let normalized = "";
    let inString = false;
    let escaped = false;
    let lastSignificant = "";
    const stack: string[] = [];
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        normalized += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        if (!/\s/.test(ch)) lastSignificant = ch;
        continue;
      }
      if (ch === '"') { inString = true; normalized += ch; lastSignificant = ch; continue; }
      if ((ch === "{" || ch === "[") ) stack.push(ch);
      if (ch === "}" || ch === "]") { if (stack.length) stack.pop(); }
      if (ch === ",") {
        let next = i + 1;
        while (next < candidate.length && /\s/.test(candidate[next])) next++;
        if (candidate[next] === "}" || candidate[next] === "]") continue;
      }
      if (stack[stack.length - 1] === "{" && (lastSignificant === "{" || lastSignificant === ",") && /[A-Za-z_$]/.test(ch)) {
        let end = i + 1;
        while (end < candidate.length && /[A-Za-z0-9_$-]/.test(candidate[end])) end++;
        let colon = end;
        while (colon < candidate.length && /\s/.test(candidate[colon])) colon++;
        if (candidate[colon] === ":") {
          const key = candidate.slice(i, end);
          normalized += JSON.stringify(key);
          lastSignificant = '"';
          i = end - 1;
          continue;
        }
      }
      normalized += ch;
      if (!/\s/.test(ch)) lastSignificant = ch;
    }
    try { return JSON.parse(normalized); }
    catch { throw originalError; }
  }
}
