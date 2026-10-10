// robots.txt (RFC 9309): pick the group for our agent (else "*"), longest matching rule wins,
// Allow wins a tie. Supports "*" and "$" in paths.

interface Rule {
  allow: boolean;
  path: string;
}

function groupsFor(body: string, agent: string): Rule[] {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const specific: Rule[] = [];
  const wildcard: Rule[] = [];
  let agents: string[] = [];
  let inRules = false;
  let foundSpecific = false;
  let foundWildcard = false;
  for (const line of lines) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    inRules = true;
    const rule = { allow: field === "allow", path: value };
    if (agents.some((a) => a !== "*" && agent.includes(a))) {
      foundSpecific = true;
      if (value || rule.allow) specific.push(rule);
    }
    if (agents.includes("*")) {
      foundWildcard = true;
      if (value || rule.allow) wildcard.push(rule);
    }
  }
  if (foundSpecific) return specific;
  return foundWildcard ? wildcard : [];
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** True if `url` may be fetched by `agentToken` (e.g. "stackquakebot"). */
export function robotsAllows(body: string, agentToken: string, url: string): boolean {
  const u = new URL(url);
  let path = u.pathname + u.search;
  try {
    path = decodeURIComponent(u.pathname) + u.search;
  } catch {
    // Malformed escapes: match against the raw path.
  }
  let best: Rule | null = null;
  for (const rule of groupsFor(body, agentToken.toLowerCase())) {
    if (!rule.path || !matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}
