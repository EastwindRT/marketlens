// Browser side of claude-bridge: copy this file into a site. Framework-free; works from any page
// on a site you've allowed (node bridge.mjs --origin https://your-site).
//
//   if (await bridge.available()) answer = await bridge.ask({ question, context, history })
//   else answer = await yourServerAi(...)        // everyone else, or when the bridge isn't running

const BRIDGE = 'http://127.0.0.1:4747'
const TOKEN_KEY = 'claude-bridge-token'
const WANTED_KEY = 'claude-bridge-wanted'
// Chrome asks "allow this site to access devices on your local network?" before a public site may
// call 127.0.0.1. This hint tells it the call is meant for this computer; other browsers ignore it.
const LOCAL = { targetAddressSpace: 'loopback' } as RequestInit

export interface BridgeQuestion {
  question: string
  /** Whatever the page knows that helps answer: sent as JSON. Keep it under ~250 KB. */
  context?: unknown
  /** Earlier questions and answers in this conversation, oldest first (the last 4 are used). */
  history?: { q: string; a: string }[]
  /** Instructions for Claude for this site (optional; the bridge has a sensible default). */
  system?: string
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}

const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export const bridge = {
  /** Save the pairing token the bridge printed (once per site, per browser). */
  pair(t: string) {
    try {
      localStorage.setItem(TOKEN_KEY, t.trim())
    } catch {
      /* private mode: pairing won't stick */
    }
  },
  unpair() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
  /** The owner turned it on in this browser (e.g. visit with ?bridge=1): wait for the browser's local-network prompt. */
  wanted: () => read(WANTED_KEY) === '1',
  want(on: boolean) {
    try {
      if (on) localStorage.setItem(WANTED_KEY, '1')
      else localStorage.removeItem(WANTED_KEY)
    } catch {
      /* ignore */
    }
  },
  /** 'off' (not running here, or this site isn't allowed), 'unpaired', or 'paired'. Gives up after timeoutMs. */
  async status(timeoutMs = 1000): Promise<'off' | 'unpaired' | 'paired'> {
    try {
      const r = await fetch(`${BRIDGE}/health`, { ...LOCAL, headers: { 'X-Bridge-Token': token() }, signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return 'off'
      return ((await r.json()) as { paired?: boolean }).paired ? 'paired' : 'unpaired'
    } catch {
      return 'off'
    }
  },
  /** Is the bridge running on this PC and paired with this browser? Answers within a second. */
  async available(): Promise<boolean> {
    try {
      const r = await fetch(`${BRIDGE}/health`, { ...LOCAL, headers: { 'X-Bridge-Token': token() }, signal: AbortSignal.timeout(1000) })
      return r.ok && ((await r.json()) as { paired?: boolean }).paired === true
    } catch {
      return false
    }
  },
  /** Ask your Claude Code. Throws with a readable message when it can't answer. */
  async ask(q: BridgeQuestion): Promise<string> {
    const r = await fetch(`${BRIDGE}/ask`, { ...LOCAL, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token() }, body: JSON.stringify(q), signal: AbortSignal.timeout(190_000) })
    const j = (await r.json().catch(() => ({}))) as { answer?: string; error?: string }
    if (!r.ok || !j.answer) throw new Error(j.error ?? `The bridge answered ${r.status}.`)
    return j.answer
  },
}
