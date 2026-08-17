// Voice widget — "Talk to the library".
//
// Vanilla-JS front-end for the PortalVoiceAgent. Loads the bundled, same-origin
// VoiceClient (public/vendor/voice-client.js, produced by esbuild from
// @cloudflare/voice/client) and wires a floating call button + panel that match
// the KUMO theme. No framework, no React hook.
//
// The agent name is the kebab-case of the Durable Object class (PortalVoiceAgent
// -> "portal-voice-agent"); routeAgentRequest() serves it at
// /agents/portal-voice-agent/<name> on this same origin.

import { VoiceClient } from "/vendor/voice-client.js";

const AGENT = "portal-voice-agent";

const STATUS_LABEL = {
  idle: "Idle",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

let client = null;
let inCall = false;

// ---- styles (self-contained, themed) -------------------------------------
const style = document.createElement("style");
style.textContent = `
.voice-fab{position:fixed;right:22px;bottom:22px;z-index:60;display:inline-flex;align-items:center;
  gap:9px;padding:13px 18px;border:none;border-radius:999px;cursor:pointer;
  font-family:var(--font-sans);font-weight:600;font-size:14px;color:#fff;
  background:var(--cf-orange,#ff6633);
  box-shadow:0 6px 22px -8px rgba(217,79,34,.7),0 2px 6px rgba(82,16,0,.18);
  transition:transform .15s ease,box-shadow .15s ease}
.voice-fab:hover{transform:translateY(-1px);box-shadow:0 10px 26px -8px rgba(217,79,34,.8)}
.voice-fab:active{transform:translateY(0)}
.voice-fab .vf-dot{width:9px;height:9px;border-radius:50%;background:#fff;opacity:.9}

.voice-panel{position:fixed;right:22px;bottom:78px;z-index:61;width:340px;max-width:calc(100vw - 44px);
  background:var(--cf-bg-100,#fffdfa);border:1px solid var(--cf-border-strong,#e0c3a8);
  border-radius:var(--radius,14px);box-shadow:0 20px 50px -20px rgba(82,16,0,.4);
  font-family:var(--font-sans);color:var(--cf-text,#521000);overflow:hidden;
  opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity .16s ease,transform .16s ease}
.voice-panel.open{opacity:1;transform:none;pointer-events:auto}

.vp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:13px 15px;border-bottom:1px solid var(--cf-border,#ebd5c1);background:var(--cf-bg-200,#faf5ee)}
.vp-title{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
.vp-orb{width:12px;height:12px;border-radius:50%;background:#b9a894;transition:background .2s,box-shadow .2s}
.vp-orb.listening{background:#2fae66;box-shadow:0 0 0 4px rgba(47,174,102,.18)}
.vp-orb.thinking{background:var(--accent-blue,#0055dc);box-shadow:0 0 0 4px rgba(0,85,220,.18)}
.vp-orb.speaking{background:var(--cf-orange,#ff6633);box-shadow:0 0 0 4px rgba(255,102,51,.22);animation:vpPulse 1s ease-in-out infinite}
@keyframes vpPulse{0%,100%{box-shadow:0 0 0 3px rgba(255,102,51,.18)}50%{box-shadow:0 0 0 7px rgba(255,102,51,.28)}}
.vp-status{font-size:12px;color:var(--cf-text-soft,#8a5a3c);font-family:var(--font-mono)}
.vp-x{border:none;background:transparent;cursor:pointer;font-size:18px;line-height:1;color:var(--cf-text-soft,#8a5a3c);padding:2px 4px;border-radius:6px}
.vp-x:hover{background:var(--cf-bg-300,#f0e7db)}

.vp-body{padding:13px 15px;max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:9px}
.vp-hint{font-size:12.5px;line-height:1.5;color:var(--cf-text-soft,#8a5a3c)}
.vp-hint b{color:var(--cf-text,#521000)}
.vp-msg{padding:9px 11px;border-radius:10px;font-size:13px;line-height:1.45;max-width:88%;white-space:pre-wrap;word-wrap:break-word}
.vp-msg.user{align-self:flex-end;background:var(--cf-orange,#ff6633);color:#fff;border-bottom-right-radius:3px}
.vp-msg.assistant{align-self:flex-start;background:var(--cf-bg-300,#f0e7db);color:var(--cf-text,#521000);border-bottom-left-radius:3px}
.vp-interim{align-self:flex-end;font-style:italic;opacity:.6;font-size:12.5px}
.vp-err{margin:0 15px 12px;padding:9px 11px;border-radius:10px;background:#fdeae4;color:#a3320f;font-size:12.5px;border:1px solid #f3c4b3;display:none}
.vp-err.show{display:block}

.vp-foot{display:flex;gap:9px;padding:12px 15px;border-top:1px solid var(--cf-border,#ebd5c1);background:var(--cf-bg-200,#faf5ee)}
.vp-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;
  padding:10px 12px;border-radius:10px;border:1px solid var(--cf-border-strong,#e0c3a8);
  background:var(--cf-bg-100,#fffdfa);color:var(--cf-text,#521000);font-family:var(--font-sans);
  font-weight:600;font-size:13px;cursor:pointer;transition:background .12s,border-color .12s}
.vp-btn:hover{background:var(--cf-bg-300,#f0e7db)}
.vp-btn.primary{background:var(--cf-orange,#ff6633);border-color:var(--cf-orange,#ff6633);color:#fff}
.vp-btn.primary:hover{background:var(--cf-orange-ink,#d94f22)}
.vp-btn.danger{color:#a3320f;border-color:#f3c4b3;background:#fdeae4}
.vp-btn[disabled]{opacity:.5;cursor:not-allowed}
.vp-beta{font-family:var(--font-mono);font-size:10px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--cf-text-soft,#8a5a3c);border:1px solid var(--cf-border,#ebd5c1);border-radius:6px;padding:2px 6px}
.vp-textrow{display:flex;gap:8px;padding:0 15px 12px}
.vp-textrow input{flex:1;min-width:0;padding:10px 12px;border-radius:10px;
  border:1px solid var(--cf-border-strong,#e0c3a8);background:var(--cf-bg-100,#fffdfa);
  color:var(--cf-text,#521000);font-family:var(--font-sans);font-size:13px}
.vp-textrow input:focus{outline:none;border-color:var(--cf-orange,#ff6633);
  box-shadow:0 0 0 3px rgba(255,102,51,.15)}
.vp-textrow #vpSend{flex:0 0 auto;padding:10px 16px}
`;
document.head.appendChild(style);

// ---- DOM ------------------------------------------------------------------
const fab = document.createElement("button");
fab.className = "voice-fab";
fab.type = "button";
fab.setAttribute("aria-label", "Talk to the library");
fab.innerHTML = `<span class="vf-dot"></span> Talk to the library`;

const panel = document.createElement("section");
panel.className = "voice-panel";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Voice assistant");
panel.innerHTML = `
  <div class="vp-head">
    <div class="vp-title"><span class="vp-orb" id="vpOrb"></span> Library voice guide <span class="vp-beta">beta</span></div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="vp-status" id="vpStatus">Idle</span>
      <button class="vp-x" id="vpClose" aria-label="Close">×</button>
    </div>
  </div>
  <div class="vp-body" id="vpBody">
    <p class="vp-hint">Ask me about the library — <b>type below</b> (works now), or
      <b>start a call</b> to talk. Try: <b>"Which portals do you track?"</b>,
      <b>"What's in the latest week?"</b>, or <b>"Tell me about ChatGPT's landing page."</b></p>
  </div>
  <div class="vp-err" id="vpErr"></div>
  <form class="vp-textrow" id="vpTextForm">
    <input id="vpText" type="text" autocomplete="off" enterkeyhint="send"
           placeholder="Type a question and press Enter…" />
    <button class="vp-btn primary" type="submit" id="vpSend">Send</button>
  </form>
  <div class="vp-foot">
    <button class="vp-btn" id="vpCall">🎙️ Start call</button>
    <button class="vp-btn" id="vpMute" disabled>Mute</button>
  </div>
`;

document.body.appendChild(fab);
document.body.appendChild(panel);

const $ = (id) => panel.querySelector(id);
const orb = $("#vpOrb");
const statusEl = $("#vpStatus");
const body = $("#vpBody");
const errEl = $("#vpErr");
const callBtn = $("#vpCall");
const muteBtn = $("#vpMute");
const textForm = $("#vpTextForm");
const textInput = $("#vpText");
let interimEl = null;

// ---- UI helpers -----------------------------------------------------------
function openPanel(open) {
  panel.classList.toggle("open", open);
  fab.style.display = open ? "none" : "";
}
function setStatus(s) {
  statusEl.textContent = STATUS_LABEL[s] || s;
  orb.className = "vp-orb " + (s || "");
}
function showError(msg) {
  if (!msg) { errEl.classList.remove("show"); errEl.textContent = ""; return; }
  errEl.textContent = msg;
  errEl.classList.add("show");
}
function renderTranscript(messages) {
  // Clear old messages (keep the hint only when empty).
  body.querySelectorAll(".vp-msg,.vp-interim").forEach((n) => n.remove());
  interimEl = null;
  if (messages && messages.length) {
    const hint = body.querySelector(".vp-hint");
    if (hint) hint.remove();
    for (const m of messages) {
      const div = document.createElement("div");
      div.className = "vp-msg " + (m.role === "user" ? "user" : "assistant");
      div.textContent = m.text;
      body.appendChild(div);
    }
  }
  body.scrollTop = body.scrollHeight;
}
function renderInterim(text) {
  if (!text) { if (interimEl) { interimEl.remove(); interimEl = null; } return; }
  if (!interimEl) {
    interimEl = document.createElement("div");
    interimEl.className = "vp-interim";
    body.appendChild(interimEl);
  }
  interimEl.textContent = text;
  body.scrollTop = body.scrollHeight;
}

// ---- call control ---------------------------------------------------------
function ensureClient() {
  if (client) return client;
  client = new VoiceClient({ agent: AGENT });
  client.addEventListener("statuschange", setStatus);
  client.addEventListener("transcriptchange", renderTranscript);
  client.addEventListener("interimtranscript", renderInterim);
  client.addEventListener("error", (e) => showError(e || null));
  client.addEventListener("mutechange", (m) => { muteBtn.textContent = m ? "Unmute" : "Mute"; });
  client.addEventListener("connectionchange", (ok) => {
    if (!ok && inCall) showError("Connection lost. Try starting the call again.");
  });
  client.connect();
  return client;
}

async function startCall() {
  showError(null);
  try {
    ensureClient();
    callBtn.disabled = true;
    await client.startCall();
    inCall = true;
    callBtn.textContent = "⏹ End call";
    callBtn.classList.remove("primary");
    callBtn.classList.add("danger");
    muteBtn.disabled = false;
  } catch (err) {
    showError(
      (err && err.name === "NotAllowedError")
        ? "Microphone permission was denied. Allow mic access and try again."
        : "Couldn't start the call: " + (err?.message || err)
    );
  } finally {
    callBtn.disabled = false;
  }
}

function endCall() {
  try { client?.endCall(); } catch {}
  inCall = false;
  callBtn.textContent = "🎙️ Start call";
  callBtn.classList.add("primary");
  callBtn.classList.remove("danger");
  muteBtn.disabled = true;
  muteBtn.textContent = "Mute";
  setStatus("idle");
}

// ---- events ---------------------------------------------------------------
fab.addEventListener("click", () => { openPanel(true); ensureClient(); });
$("#vpClose").addEventListener("click", () => { if (inCall) endCall(); openPanel(false); });
callBtn.addEventListener("click", () => (inCall ? endCall() : startCall()));
muteBtn.addEventListener("click", () => client?.toggleMute());

// Text mode — works without a mic/call: sendText() routes through onTurn() (D1),
// and when not in a call the agent replies with text only (no TTS needed).
textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = textInput.value.trim();
  if (!q) return;
  showError(null);
  ensureClient();
  // The socket may still be opening; wait (up to ~5s) for it, then send.
  let tries = 0;
  const trySend = () => {
    if (client.connected) { client.sendText(q); return; }
    if (tries++ < 25) { setTimeout(trySend, 200); return; }
    showError("Couldn't reach the agent. Check the connection and try again.");
  };
  trySend();
  textInput.value = "";
  textInput.focus();
});
