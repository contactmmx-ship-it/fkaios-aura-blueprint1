// Safe JSON parse recovery for a common LLM formatting error: trailing commas.
// This scans outside quoted strings so text values containing ', }' or ', ]'
// are never rewritten. All other malformed JSON remains a hard failure.
export function parseJSONCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch (originalError) {
    let normalized = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        normalized += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; normalized += ch; continue; }
      if (ch === ",") {
        let next = i + 1;
        while (next < candidate.length && /\s/.test(candidate[next])) next++;
        if (candidate[next] === "}" || candidate[next] === "]") continue;
      }
      normalized += ch;
    }
    try { return JSON.parse(normalized); }
    catch { throw originalError; }
  }
}
