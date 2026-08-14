// node_modules/@cloudflare/voice/dist/types-RutX7tlR.js
var VOICE_PROTOCOL_VERSION = 1;

// node_modules/partysocket/dist/ws.js
if (!globalThis.EventTarget || !globalThis.Event)
  console.error(`
  PartySocket requires a global 'EventTarget' class to be available!
  You can polyfill this global by adding this to your code before any partysocket imports: 
  
  \`\`\`
  import 'partysocket/event-target-polyfill';
  \`\`\`
  Please file an issue at https://github.com/partykit/partykit if you're still having trouble.
`);
var ErrorEvent = class extends Event {
  message;
  error;
  constructor(error, target) {
    super("error", target);
    this.message = error.message;
    this.error = error;
  }
};
var CloseEvent = class extends Event {
  code;
  reason;
  wasClean = true;
  constructor(code = 1e3, reason = "", target) {
    super("close", target);
    this.code = code;
    this.reason = reason;
  }
};
var Events = {
  Event,
  ErrorEvent,
  CloseEvent
};
function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}
function cloneEventBrowser(e) {
  return new e.constructor(e.type, e);
}
function cloneEventNode(e) {
  if ("data" in e) return new MessageEvent(e.type, e);
  if ("code" in e || "reason" in e)
    return new CloseEvent(e.code || 1999, e.reason || "unknown reason", e);
  if ("error" in e) return new ErrorEvent(e.error, e);
  return new Event(e.type, e);
}
var isNode = typeof process !== "undefined" && typeof process.versions?.node !== "undefined";
var isReactNative = typeof navigator !== "undefined" && navigator.product === "ReactNative";
var cloneEvent = isNode || isReactNative ? cloneEventNode : cloneEventBrowser;
var DEFAULT = {
  maxReconnectionDelay: 1e4,
  minReconnectionDelay: 3e3,
  minUptime: 5e3,
  reconnectionDelayGrowFactor: 1.3,
  connectionTimeout: 4e3,
  maxRetries: Number.POSITIVE_INFINITY,
  maxEnqueuedMessages: Number.POSITIVE_INFINITY,
  startClosed: false,
  debug: false
};
var didWarnAboutMissingWebSocket = false;
function absorbError() {
}
var ReconnectingWebSocket = class ReconnectingWebSocket2 extends EventTarget {
  _ws;
  _retryCount = -1;
  _uptimeTimeout;
  _connectTimeout;
  _shouldReconnect = true;
  _connectLock = false;
  _binaryType = "blob";
  _closeCalled = false;
  _didWarnAboutClosedSend = false;
  _messageQueue = [];
  _debugLogger = console.log.bind(console);
  _url;
  _protocols;
  _options;
  constructor(url, protocols, options = {}) {
    super();
    this._url = url;
    this._protocols = protocols;
    this._options = options;
    if (this._options.startClosed) this._shouldReconnect = false;
    if (this._options.debugLogger)
      this._debugLogger = this._options.debugLogger;
    this._connect();
  }
  static get CONNECTING() {
    return 0;
  }
  static get OPEN() {
    return 1;
  }
  static get CLOSING() {
    return 2;
  }
  static get CLOSED() {
    return 3;
  }
  get CONNECTING() {
    return ReconnectingWebSocket2.CONNECTING;
  }
  get OPEN() {
    return ReconnectingWebSocket2.OPEN;
  }
  get CLOSING() {
    return ReconnectingWebSocket2.CLOSING;
  }
  get CLOSED() {
    return ReconnectingWebSocket2.CLOSED;
  }
  get binaryType() {
    return this._ws ? this._ws.binaryType : this._binaryType;
  }
  set binaryType(value) {
    this._binaryType = value;
    if (this._ws) this._ws.binaryType = value;
  }
  /**
   * Returns the number or connection retries
   */
  get retryCount() {
    return Math.max(this._retryCount, 0);
  }
  /**
   * The number of bytes of data that have been queued using calls to send() but not yet
   * transmitted to the network. This value resets to zero once all queued data has been sent.
   * This value does not reset to zero when the connection is closed; if you keep calling send(),
   * this will continue to climb. Read only
   */
  get bufferedAmount() {
    return this._messageQueue.reduce((acc, message) => {
      if (typeof message === "string") acc += message.length;
      else if (message instanceof Blob) acc += message.size;
      else acc += message.byteLength;
      return acc;
    }, 0) + (this._ws ? this._ws.bufferedAmount : 0);
  }
  /**
   * The extensions selected by the server. This is currently only the empty string or a list of
   * extensions as negotiated by the connection
   */
  get extensions() {
    return this._ws ? this._ws.extensions : "";
  }
  /**
   * A string indicating the name of the sub-protocol the server selected;
   * this will be one of the strings specified in the protocols parameter when creating the
   * WebSocket object
   */
  get protocol() {
    return this._ws ? this._ws.protocol : "";
  }
  /**
   * The current state of the connection; this is one of the Ready state constants
   */
  get readyState() {
    if (this._closeCalled) return ReconnectingWebSocket2.CLOSED;
    if (this._ws) return this._ws.readyState;
    return this._options.startClosed ? ReconnectingWebSocket2.CLOSED : ReconnectingWebSocket2.CONNECTING;
  }
  /**
   * The URL as resolved by the constructor
   */
  get url() {
    return this._ws ? this._ws.url : "";
  }
  /**
   * Whether the websocket object is now in reconnectable state
   */
  get shouldReconnect() {
    return this._shouldReconnect;
  }
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to CLOSED
   */
  onclose = null;
  /**
   * An event listener to be called when an error occurs
   */
  onerror = null;
  /**
   * An event listener to be called when a message is received from the server
   */
  onmessage = null;
  /**
   * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
   * this indicates that the connection is ready to send and receive data
   */
  onopen = null;
  /**
   * Closes the WebSocket connection or connection attempt, if any. If the connection is already
   * CLOSED or CLOSING, this method does nothing.
   *
   * The `close` event is dispatched synchronously (mirroring how
   * `reconnect()` dispatches its synthetic close). This guarantees
   * consumers observe a terminal event for every explicit close, even
   * if their listeners are detached right after this call — previously
   * the real (asynchronous) browser close event could fire after
   * listeners were removed and go unobserved entirely.
   */
  close(code = 1e3, reason) {
    this._closeCalled = true;
    this._shouldReconnect = false;
    this._clearTimeouts();
    if (!this._ws) {
      this._debug("close enqueued: no ws instance");
      return;
    }
    if (this._ws.readyState === this.CLOSED || this._ws.readyState === this.CLOSING) {
      this._debug("close: already closing or closed");
      return;
    }
    this._disconnect(code, reason);
  }
  /**
   * Closes the WebSocket connection or connection attempt and connects again.
   * Resets retry counter;
   */
  reconnect(code, reason) {
    this._shouldReconnect = true;
    this._closeCalled = false;
    this._didWarnAboutClosedSend = false;
    this._retryCount = -1;
    if (!this._ws || this._ws.readyState === this.CLOSED || this._ws.readyState === this.CLOSING)
      this._connect();
    else {
      this._disconnect(code, reason);
      this._connect();
    }
  }
  /**
   * Enqueue specified data to be transmitted to the server over the WebSocket connection.
   *
   * @returns `true` if the message was transmitted immediately over an open
   * connection; `false` if it was buffered (sent when the connection next
   * opens — the buffer is always flushed before the `open` event is
   * dispatched) or dropped because `maxEnqueuedMessages` was reached.
   */
  send(data) {
    if (this._ws && this._ws.readyState === this.OPEN) {
      this._debug("send", data);
      this._ws.send(data);
      return true;
    }
    if (this._closeCalled && !this._didWarnAboutClosedSend) {
      this._didWarnAboutClosedSend = true;
      console.warn(
        "ReconnectingWebSocket: send() was called after close(). The message has been buffered, but it will only be delivered if reconnect() is called on this socket. If this socket has been discarded, the message is lost \u2014 this usually means a stale socket reference is being used."
      );
    }
    const { maxEnqueuedMessages = DEFAULT.maxEnqueuedMessages } = this._options;
    if (this._messageQueue.length < maxEnqueuedMessages) {
      this._debug("enqueue", data);
      this._messageQueue.push(data);
    }
    return false;
  }
  /**
   * Removes and returns all messages that were passed to send() but never
   * transmitted (they were buffered while the connection wasn't open).
   *
   * Useful when a socket is being discarded and replaced (e.g. the React
   * hooks recreate the socket when connection options change): the
   * replacement socket can re-send these messages, instead of them being
   * silently lost with the old instance.
   */
  drainQueuedMessages() {
    const queue = this._messageQueue;
    this._messageQueue = [];
    return queue;
  }
  _debug(...args) {
    if (this._options.debug) this._debugLogger("RWS>", ...args);
  }
  _getNextDelay() {
    const {
      reconnectionDelayGrowFactor = DEFAULT.reconnectionDelayGrowFactor,
      minReconnectionDelay = DEFAULT.minReconnectionDelay,
      maxReconnectionDelay = DEFAULT.maxReconnectionDelay
    } = this._options;
    let delay = 0;
    if (this._retryCount > 0) {
      delay = minReconnectionDelay * reconnectionDelayGrowFactor ** (this._retryCount - 1);
      if (delay > maxReconnectionDelay) delay = maxReconnectionDelay;
    }
    this._debug("next delay", delay);
    return delay;
  }
  _wait() {
    return new Promise((resolve) => {
      setTimeout(resolve, this._getNextDelay());
    });
  }
  _getNextProtocols(protocolsProvider) {
    if (!protocolsProvider) return Promise.resolve(null);
    if (typeof protocolsProvider === "string" || Array.isArray(protocolsProvider))
      return Promise.resolve(protocolsProvider);
    if (typeof protocolsProvider === "function") {
      const protocols = protocolsProvider();
      if (!protocols) return Promise.resolve(null);
      if (typeof protocols === "string" || Array.isArray(protocols))
        return Promise.resolve(protocols);
      if (protocols.then) return protocols;
    }
    throw Error("Invalid protocols");
  }
  _getNextUrl(urlProvider) {
    if (typeof urlProvider === "string") return Promise.resolve(urlProvider);
    if (typeof urlProvider === "function") {
      const url = urlProvider();
      if (typeof url === "string") return Promise.resolve(url);
      if (url.then) return url;
    }
    throw Error("Invalid URL");
  }
  _connect() {
    if (this._connectLock || !this._shouldReconnect) return;
    this._connectLock = true;
    const {
      maxRetries = DEFAULT.maxRetries,
      connectionTimeout = DEFAULT.connectionTimeout
    } = this._options;
    if (this._retryCount >= maxRetries) {
      this._debug("max retries reached", this._retryCount, ">=", maxRetries);
      this._connectLock = false;
      return;
    }
    this._retryCount++;
    this._debug("connect", this._retryCount);
    this._removeListeners();
    this._wait().then(
      () => Promise.all([
        this._getNextUrl(this._url),
        this._getNextProtocols(this._protocols || null)
      ])
    ).then(([url, protocols]) => {
      if (this._closeCalled) {
        this._connectLock = false;
        return;
      }
      if (!this._options.WebSocket && typeof WebSocket === "undefined" && !didWarnAboutMissingWebSocket) {
        console.error(`\u203C\uFE0F No WebSocket implementation available. You should define options.WebSocket. 

For example, if you're using node.js, run \`npm install ws\`, and then in your code:

import PartySocket from 'partysocket';
import WS from 'ws';

const partysocket = new PartySocket({
  host: "127.0.0.1:1999",
  room: "test-room",
  WebSocket: WS
});

`);
        didWarnAboutMissingWebSocket = true;
      }
      const WS = this._options.WebSocket || WebSocket;
      this._debug("connect", {
        url,
        protocols
      });
      this._ws = protocols ? new WS(url, protocols) : new WS(url);
      this._ws.binaryType = this._binaryType;
      this._connectLock = false;
      this._addListeners();
      this._connectTimeout = setTimeout(
        () => this._handleTimeout(),
        connectionTimeout
      );
    }).catch((err) => {
      this._connectLock = false;
      this._handleError(new Events.ErrorEvent(Error(err.message), this));
    });
  }
  _handleTimeout() {
    this._debug("timeout event");
    this._handleError(new Events.ErrorEvent(Error("TIMEOUT"), this));
  }
  _disconnect(code = 1e3, reason) {
    this._clearTimeouts();
    if (!this._ws) return;
    this._removeListeners();
    try {
      if (this._ws.readyState === this.OPEN || this._ws.readyState === this.CONNECTING)
        this._ws.close(code, reason);
      this._handleClose(new Events.CloseEvent(code, reason, this));
    } catch (_error) {
    }
  }
  _acceptOpen() {
    this._debug("accept open");
    this._retryCount = 0;
  }
  _handleOpen = (event) => {
    this._debug("open event");
    const { minUptime = DEFAULT.minUptime } = this._options;
    clearTimeout(this._connectTimeout);
    this._uptimeTimeout = setTimeout(() => this._acceptOpen(), minUptime);
    assert(this._ws, "WebSocket is not defined");
    this._ws.binaryType = this._binaryType;
    this._messageQueue.forEach((message) => {
      this._ws?.send(message);
    });
    this._messageQueue = [];
    if (this.onopen) this.onopen(event);
    this.dispatchEvent(cloneEvent(event));
  };
  _handleMessage = (event) => {
    this._debug("message event");
    if (this.onmessage) this.onmessage(event);
    this.dispatchEvent(cloneEvent(event));
  };
  _handleError = (event) => {
    this._debug("error event", event.message);
    this._disconnect(void 0, event.message === "TIMEOUT" ? "timeout" : void 0);
    if (this.onerror) this.onerror(event);
    this._debug("exec error listeners");
    this.dispatchEvent(cloneEvent(event));
    this._connect();
  };
  _handleClose = (event) => {
    this._debug("close event");
    this._clearTimeouts();
    if (this._options.shouldReconnectOnClose && !this._options.shouldReconnectOnClose(event))
      this._shouldReconnect = false;
    if (this._shouldReconnect) this._connect();
    if (this.onclose) this.onclose(event);
    this.dispatchEvent(cloneEvent(event));
  };
  _removeListeners() {
    if (!this._ws) return;
    this._debug("removeListeners");
    this._ws.removeEventListener("open", this._handleOpen);
    this._ws.removeEventListener("close", this._handleClose);
    this._ws.removeEventListener("message", this._handleMessage);
    this._ws.removeEventListener("error", this._handleError);
    this._ws.addEventListener("error", absorbError);
  }
  _addListeners() {
    if (!this._ws) return;
    this._debug("addListeners");
    this._ws.addEventListener("open", this._handleOpen);
    this._ws.addEventListener("close", this._handleClose);
    this._ws.addEventListener("message", this._handleMessage);
    this._ws.addEventListener("error", this._handleError);
  }
  _clearTimeouts() {
    clearTimeout(this._connectTimeout);
    clearTimeout(this._uptimeTimeout);
  }
};

// node_modules/partysocket/dist/index.js
var valueIsNotNil = (keyValuePair) => keyValuePair[1] !== null && keyValuePair[1] !== void 0;
function generateUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  let d = Date.now();
  let d2 = performance?.now && performance.now() * 1e3 || 0;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function getPartyInfo(partySocketOptions, defaultProtocol, defaultParams = {}) {
  const {
    host: rawHost,
    path: rawPath,
    protocol: rawProtocol,
    room,
    party,
    basePath,
    prefix,
    query
  } = partySocketOptions;
  let host = rawHost.replace(/^(http|https|ws|wss):\/\//, "");
  if (host.endsWith("/")) host = host.slice(0, -1);
  if (rawPath?.startsWith("/"))
    throw new Error("path must not start with a slash");
  const name = party ?? "main";
  const path = rawPath ? `/${rawPath}` : "";
  const protocol = rawProtocol || (host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.") && host.split(".")[1] >= "16" && host.split(".")[1] <= "31" || host.startsWith("[::ffff:7f00:1]:") ? defaultProtocol : `${defaultProtocol}s`);
  const baseUrl = `${protocol}://${host}/${basePath || `${prefix || "parties"}/${name}/${room}`}${path}`;
  const makeUrl = (query2 = {}) => `${baseUrl}?${new URLSearchParams([...Object.entries(defaultParams), ...Object.entries(query2).filter(valueIsNotNil)])}`;
  const urlProvider = typeof query === "function" ? async () => makeUrl(await query()) : makeUrl(query);
  return {
    host,
    path,
    room,
    name,
    protocol,
    partyUrl: baseUrl,
    urlProvider
  };
}
var PartySocket = class extends ReconnectingWebSocket {
  _pk;
  _pkurl;
  name;
  room;
  host;
  path;
  basePath;
  constructor(partySocketOptions) {
    const wsOptions = getWSOptions(partySocketOptions);
    super(wsOptions.urlProvider, wsOptions.protocols, wsOptions.socketOptions);
    this.partySocketOptions = partySocketOptions;
    this.setWSProperties(wsOptions);
    if (!partySocketOptions.startClosed && !this.room && !this.basePath) {
      this.close();
      throw new Error(
        "Either room or basePath must be provided to connect. Use startClosed: true to create a socket and set them via updateProperties before calling reconnect()."
      );
    }
    if (!partySocketOptions.disableNameValidation) {
      if (partySocketOptions.party?.includes("/"))
        console.warn(
          `PartySocket: party name "${partySocketOptions.party}" contains forward slash which may cause routing issues. Consider using a name without forward slashes or set disableNameValidation: true to bypass this warning.`
        );
      if (partySocketOptions.room?.includes("/"))
        console.warn(
          `PartySocket: room name "${partySocketOptions.room}" contains forward slash which may cause routing issues. Consider using a name without forward slashes or set disableNameValidation: true to bypass this warning.`
        );
    }
  }
  updateProperties(partySocketOptions) {
    const wsOptions = getWSOptions({
      ...this.partySocketOptions,
      ...partySocketOptions,
      host: partySocketOptions.host ?? this.host,
      room: partySocketOptions.room ?? this.room,
      path: partySocketOptions.path ?? this.path,
      basePath: partySocketOptions.basePath ?? this.basePath
    });
    this._url = wsOptions.urlProvider;
    this._protocols = wsOptions.protocols;
    this._options = wsOptions.socketOptions;
    this.setWSProperties(wsOptions);
  }
  setWSProperties(wsOptions) {
    const { _pk, _pkurl, name, room, host, path, basePath } = wsOptions;
    this._pk = _pk;
    this._pkurl = _pkurl;
    this.name = name;
    this.room = room;
    this.host = host;
    this.path = path;
    this.basePath = basePath;
  }
  reconnect(code, reason) {
    if (!this.host)
      throw new Error(
        "The host must be set before connecting, use `updateProperties` method to set it or pass it to the constructor."
      );
    if (!this.room && !this.basePath)
      throw new Error(
        "The room (or basePath) must be set before connecting, use `updateProperties` method to set it or pass it to the constructor."
      );
    super.reconnect(code, reason);
  }
  get id() {
    return this._pk;
  }
  /**
   * Exposes the static PartyKit room URL without applying query parameters.
   * To access the currently connected WebSocket url, use PartySocket#url.
   */
  get roomUrl() {
    return this._pkurl;
  }
  static async fetch(options, init) {
    const party = getPartyInfo(options, "http");
    const url = typeof party.urlProvider === "string" ? party.urlProvider : await party.urlProvider();
    return (options.fetch ?? fetch)(url, init);
  }
};
function getWSOptions(partySocketOptions) {
  const {
    id,
    host: _host,
    path: _path,
    party: _party,
    room: _room,
    protocol: _protocol,
    query: _query,
    protocols,
    ...socketOptions
  } = partySocketOptions;
  const _pk = id || generateUUID();
  const party = getPartyInfo(partySocketOptions, "ws", { _pk });
  return {
    _pk,
    _pkurl: party.partyUrl,
    name: party.name,
    room: party.room,
    host: party.host,
    path: party.path,
    basePath: partySocketOptions.basePath,
    protocols,
    socketOptions,
    urlProvider: party.urlProvider
  };
}

// node_modules/@cloudflare/voice/dist/voice-client.js
function camelCaseToKebabCase(str) {
  if (str === str.toUpperCase() && str !== str.toLowerCase()) return str.toLowerCase().replace(/_/g, "-");
  let kebabified = str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  kebabified = kebabified.startsWith("-") ? kebabified.slice(1) : kebabified;
  return kebabified.replace(/_/g, "-").replace(/-$/, "");
}
var UNSUPPORTED_OUTPUT_DEVICE_ERROR = "Audio output device selection is not supported in this browser.";
var OUTPUT_DEVICE_SWITCH_ERROR = "Could not switch audio output device.";
var WORKLET_PROCESSOR = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.sampleRate = sampleRate;
    this.targetRate = 16000;
    this.ratio = this.sampleRate / this.targetRate;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    // Linear interpolation resampling (e.g. 48kHz \u2192 16kHz).
    // Nearest-neighbor (picking every Nth sample) introduces aliasing
    // artifacts, especially on sibilants (s, f, th). Linear interpolation
    // blends adjacent samples, acting as a basic low-pass filter.
    for (let i = 0; i < channelData.length; i += this.ratio) {
      const idx = Math.floor(i);
      const frac = i - idx;
      if (idx + 1 < channelData.length) {
        this.buffer.push(channelData[idx] * (1 - frac) + channelData[idx + 1] * frac);
      } else if (idx < channelData.length) {
        this.buffer.push(channelData[idx]);
      }
    }

    if (this.buffer.length >= 1600) {
      const chunk = new Float32Array(this.buffer);
      this.port.postMessage({ type: 'audio', samples: chunk }, [chunk.buffer]);
      this.buffer = [];
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;
function floatTo16BitPCM(samples) {
  const buffer = /* @__PURE__ */ new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buffer;
}
function computeRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
var WebSocketVoiceTransport = class {
  #socket;
  #options;
  constructor(options) {
    this.#socket = null;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.#options = options;
  }
  get connected() {
    return this.#socket?.readyState === WebSocket.OPEN;
  }
  sendJSON(data) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(data));
  }
  sendBinary(data) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(data);
  }
  connect() {
    if (this.#socket) return;
    const socket = new PartySocket({
      party: camelCaseToKebabCase(this.#options.agent),
      room: this.#options.name ?? "default",
      host: this.#options.host ?? window.location.host,
      prefix: "agents",
      query: this.#options.query
    });
    socket.onopen = () => this.onopen?.();
    socket.onclose = () => this.onclose?.();
    socket.onerror = () => this.onerror?.();
    socket.onmessage = (event) => {
      this.onmessage?.(event.data);
    };
    this.#socket = socket;
  }
  disconnect() {
    this.#socket?.close();
    this.#socket = null;
  }
};
var VoiceClient = class {
  #status = "idle";
  #transcript = [];
  #metrics = null;
  #audioLevel = 0;
  #isMuted = false;
  #connected = false;
  #error = null;
  #outputDeviceError = null;
  #lastCustomMessage = null;
  #audioFormat = null;
  /** Sample rate for raw pcm16 payloads; set from server `audio_config`. */
  #sampleRate = 16e3;
  #interimTranscript = null;
  #serverProtocolVersion = null;
  #inCall = false;
  #callGeneration = 0;
  #serverCallAcknowledged = false;
  #silenceThreshold;
  #silenceDurationMs;
  #interruptThreshold;
  #interruptChunks;
  #maxTranscriptMessages;
  #transport = null;
  #options;
  #audioContext = null;
  #workletRegistered = false;
  #workletNode = null;
  #stream = null;
  #silenceTimer = null;
  #isSpeaking = false;
  #playbackQueue = [];
  #isPlaying = false;
  #isScheduling = false;
  #scheduledSources = /* @__PURE__ */ new Set();
  #playbackCursor = 0;
  #lastPlaybackEnd = null;
  #playbackElement = null;
  #playbackDestination = null;
  #playbackDestinationPromise = null;
  #useDefaultPlaybackDestination = false;
  #outputDeviceId;
  #outputDeviceSwitchGeneration = 0;
  #playbackOutputGeneration = 0;
  #playbackGeneration = 0;
  #interruptChunkCount = 0;
  #listeners = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#options = options;
    this.#silenceThreshold = options.silenceThreshold ?? 0.04;
    this.#silenceDurationMs = options.silenceDurationMs ?? 500;
    this.#interruptThreshold = options.interruptThreshold ?? 0.05;
    this.#interruptChunks = options.interruptChunks ?? 2;
    this.#maxTranscriptMessages = options.maxTranscriptMessages ?? 200;
    this.#outputDeviceId = options.outputDeviceId ?? "default";
  }
  get status() {
    return this.#status;
  }
  get transcript() {
    return this.#transcript;
  }
  get metrics() {
    return this.#metrics;
  }
  get audioLevel() {
    return this.#audioLevel;
  }
  get isMuted() {
    return this.#isMuted;
  }
  get connected() {
    return this.#connected;
  }
  get error() {
    return this.#error;
  }
  get outputDeviceError() {
    return this.#outputDeviceError;
  }
  /**
  * The current interim (partial) transcript from streaming STT.
  * Updates in real time as the user speaks. Cleared when the final
  * transcript is produced. null when no interim text is available.
  */
  get interimTranscript() {
    return this.#interimTranscript;
  }
  /**
  * The protocol version reported by the server.
  * null until the server sends its welcome message.
  */
  get serverProtocolVersion() {
    return this.#serverProtocolVersion;
  }
  addEventListener(event, listener) {
    let set = this.#listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
  }
  removeEventListener(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }
  #emit(event, data) {
    const set = this.#listeners.get(event);
    if (set) for (const listener of set) listener(data);
  }
  #trimTranscript() {
    if (this.#transcript.length > this.#maxTranscriptMessages) this.#transcript = this.#transcript.slice(-this.#maxTranscriptMessages);
  }
  #setOutputDeviceError(error) {
    if (this.#outputDeviceError === error) return;
    this.#outputDeviceError = error;
    this.#emit("outputdeviceerror", error);
  }
  connect() {
    if (this.#transport) return;
    const transport = this.#options.transport ?? new WebSocketVoiceTransport({
      agent: this.#options.agent,
      name: this.#options.name,
      host: this.#options.host,
      query: this.#options.query
    });
    transport.onopen = () => {
      this.#connected = true;
      this.#error = null;
      transport.sendJSON({
        type: "hello",
        protocol_version: 1
      });
      this.#emit("connectionchange", true);
      this.#emit("error", null);
      if (this.#inCall) {
        this.#serverCallAcknowledged = false;
        transport.sendJSON({ type: "start_call" });
      }
    };
    transport.onclose = () => {
      this.#connected = false;
      this.#emit("connectionchange", false);
    };
    transport.onerror = () => {
      this.#error = "Connection lost. Reconnecting...";
      this.#emit("error", this.#error);
    };
    transport.onmessage = (data) => {
      if (typeof data === "string") this.#handleJSONMessage(data);
      else if (data instanceof Blob) data.arrayBuffer().then((buffer) => {
        this.#playbackQueue.push(buffer);
        this.#processPlaybackQueue();
      });
      else if (data instanceof ArrayBuffer) {
        this.#playbackQueue.push(data);
        this.#processPlaybackQueue();
      }
    };
    this.#transport = transport;
    transport.connect();
  }
  disconnect() {
    this.endCall();
    this.#transport?.disconnect();
    this.#transport = null;
    this.#connected = false;
    this.#emit("connectionchange", false);
  }
  async startCall() {
    if (!this.#transport?.connected) {
      this.#error = "Cannot start call: not connected. Call connect() first.";
      this.#emit("error", this.#error);
      return;
    }
    if (this.#inCall) return;
    const callGeneration = ++this.#callGeneration;
    this.#inCall = true;
    this.#serverCallAcknowledged = false;
    this.#error = null;
    this.#metrics = null;
    this.#emit("error", null);
    this.#emit("metricschange", null);
    const startMsg = { type: "start_call" };
    if (this.#options.preferredFormat) startMsg.preferred_format = this.#options.preferredFormat;
    this.#transport.sendJSON(startMsg);
    const ctx = await this.#getAudioContext();
    if (this.#abortStaleCallStartup(callGeneration)) return;
    await this.#getPlaybackDestination(ctx);
    if (this.#abortStaleCallStartup(callGeneration)) return;
    if (this.#options.audioInput) {
      this.#options.audioInput.onAudioLevel = (rms) => this.#processAudioLevel(rms);
      this.#options.audioInput.onAudioData = (pcm) => {
        if (this.#transport?.connected && !this.#isMuted) this.#transport.sendBinary(pcm);
      };
      await this.#options.audioInput.start();
    } else await this.#startMic();
    this.#abortStaleCallStartup(callGeneration);
  }
  endCall() {
    this.#callGeneration++;
    this.#inCall = false;
    this.#serverCallAcknowledged = false;
    if (this.#transport?.connected) this.#transport.sendJSON({ type: "end_call" });
    this.#stopLocalCall();
    this.#status = "idle";
    this.#emit("statuschange", "idle");
  }
  #isCurrentCallStartup(callGeneration) {
    return this.#inCall && this.#callGeneration === callGeneration;
  }
  #abortStaleCallStartup(callGeneration) {
    if (this.#isCurrentCallStartup(callGeneration)) return false;
    if (!this.#inCall) this.#stopLocalCall();
    return true;
  }
  #stopLocalCall() {
    if (this.#options.audioInput) {
      this.#options.audioInput.stop();
      this.#options.audioInput.onAudioLevel = null;
      this.#options.audioInput.onAudioData = null;
    } else this.#stopMic();
    this.#stopPlayback();
    this.#closeAudioContext();
    this.#resetDetection();
  }
  toggleMute() {
    this.#isMuted = !this.#isMuted;
    if (this.#isMuted) {
      this.#audioLevel = 0;
      this.#emit("audiolevelchange", 0);
    }
    if (this.#isMuted && this.#isSpeaking) {
      this.#isSpeaking = false;
      if (this.#silenceTimer) {
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = null;
      }
      if (this.#transport?.connected) this.#transport.sendJSON({ type: "end_of_speech" });
    }
    this.#emit("mutechange", this.#isMuted);
  }
  /**
  * Send a text message to the agent. The agent processes it through
  * `onTurn()` (bypassing STT) and responds with text transcript and
  * TTS audio (if in a call) or text-only (if not).
  */
  sendText(text) {
    if (this.#transport?.connected) this.#transport.sendJSON({
      type: "text_message",
      text
    });
  }
  /**
  * Send arbitrary JSON to the agent. Use this for app-level messages
  * that are not part of the voice protocol (e.g. `{ type: "kick_speaker" }`).
  * The server receives these in the consumer's `onMessage()` handler.
  */
  sendJSON(data) {
    if (this.#transport?.connected) this.#transport.sendJSON(data);
  }
  /**
  * Set the preferred audio output device for assistant playback.
  * Unsupported browsers continue playing through the default output.
  */
  async setOutputDevice(outputDeviceId) {
    this.#outputDeviceId = outputDeviceId ?? "default";
    const generation = ++this.#outputDeviceSwitchGeneration;
    if (this.#playbackElement) await this.#applyOutputDevice(this.#playbackElement, generation);
  }
  /**
  * The last custom (non-voice-protocol) message received from the server.
  * Listen for the `"custommessage"` event to be notified when this changes.
  */
  get lastCustomMessage() {
    return this.#lastCustomMessage;
  }
  /**
  * The audio format the server declared for binary payloads.
  * Set when the server sends `audio_config` at call start.
  */
  get audioFormat() {
    return this.#audioFormat;
  }
  /**
  * The sample rate (Hz) the server declared for raw pcm16 payloads.
  * Set when the server sends `audio_config` at call start. Defaults to 16000.
  */
  get sampleRate() {
    return this.#sampleRate;
  }
  #handleJSONMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.#serverProtocolVersion = msg.protocol_version;
        if (msg.protocol_version !== 1) console.warn(`[VoiceClient] Protocol version mismatch: client=1, server=${msg.protocol_version}`);
        break;
      case "audio_config":
        this.#serverCallAcknowledged = true;
        this.#audioFormat = msg.format;
        this.#sampleRate = typeof msg.sampleRate === "number" && msg.sampleRate > 0 ? msg.sampleRate : 16e3;
        break;
      case "status":
        this.#status = msg.status;
        if (msg.status === "idle" && this.#inCall) {
          if (!(this.#serverCallAcknowledged || this.#error !== null)) {
            this.#emit("statuschange", this.#status);
            break;
          }
          this.#callGeneration++;
          this.#inCall = false;
          this.#serverCallAcknowledged = false;
          this.#stopLocalCall();
        }
        if (msg.status === "listening") {
          this.#serverCallAcknowledged = true;
          this.#error = null;
          this.#emit("error", null);
        } else if (msg.status === "thinking" || msg.status === "speaking") this.#serverCallAcknowledged = true;
        this.#emit("statuschange", this.#status);
        break;
      case "transcript_interim":
        this.#interimTranscript = msg.text;
        this.#emit("interimtranscript", this.#interimTranscript);
        break;
      case "playback_interrupt":
        this.#stopPlayback();
        break;
      case "transcript":
        this.#interimTranscript = null;
        this.#emit("interimtranscript", null);
        if (msg.role === "user" && this.#isPlaying) this.#stopPlayback();
        this.#transcript = [...this.#transcript, {
          role: msg.role,
          text: msg.text,
          timestamp: Date.now()
        }];
        this.#trimTranscript();
        this.#emit("transcriptchange", this.#transcript);
        break;
      case "transcript_start":
        this.#transcript = [...this.#transcript, {
          role: "assistant",
          text: "",
          timestamp: Date.now()
        }];
        this.#trimTranscript();
        this.#emit("transcriptchange", this.#transcript);
        break;
      case "transcript_delta": {
        if (this.#transcript.length === 0) break;
        const updated = [...this.#transcript];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            text: last.text + msg.text
          };
          this.#transcript = updated;
          this.#emit("transcriptchange", this.#transcript);
        }
        break;
      }
      case "transcript_end": {
        if (this.#transcript.length === 0) break;
        const updated = [...this.#transcript];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            text: msg.text
          };
          this.#transcript = updated;
          this.#emit("transcriptchange", this.#transcript);
        }
        break;
      }
      case "metrics":
        this.#metrics = {
          llm_ms: msg.llm_ms,
          tts_ms: msg.tts_ms,
          first_audio_ms: msg.first_audio_ms,
          total_ms: msg.total_ms
        };
        this.#emit("metricschange", this.#metrics);
        break;
      case "error":
        this.#error = msg.message;
        this.#emit("error", this.#error);
        break;
      default:
        this.#lastCustomMessage = msg;
        this.#emit("custommessage", msg);
        break;
    }
  }
  /** Get or create the shared AudioContext. */
  async #getAudioContext() {
    if (!this.#audioContext) this.#audioContext = new AudioContext({ sampleRate: 48e3 });
    if (this.#audioContext.state === "suspended") await this.#audioContext.resume();
    return this.#audioContext;
  }
  /** Close the AudioContext and release resources. */
  #closeAudioContext() {
    if (this.#audioContext) {
      this.#closePlaybackOutput();
      this.#audioContext.close().catch(() => {
      });
      this.#audioContext = null;
      this.#workletRegistered = false;
    }
  }
  async #getPlaybackDestination(ctx) {
    if (this.#playbackDestinationPromise) return this.#playbackDestinationPromise;
    if (this.#playbackDestination) return this.#playbackDestination;
    if (this.#useDefaultPlaybackDestination) return ctx.destination;
    const outputGeneration = this.#playbackOutputGeneration;
    const promise = this.#initializePlaybackDestination(ctx, outputGeneration);
    this.#playbackDestinationPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.#playbackDestinationPromise === promise) this.#playbackDestinationPromise = null;
    }
  }
  async #initializePlaybackDestination(ctx, outputGeneration) {
    try {
      const destination = ctx.createMediaStreamDestination();
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = destination.stream;
      this.#playbackElement = audio;
      this.#playbackDestination = destination;
      await this.#applyOutputDevice(audio, this.#outputDeviceSwitchGeneration);
      if (!this.#isCurrentPlaybackOutput(audio, outputGeneration)) {
        this.#releasePlaybackElement(audio);
        return ctx.destination;
      }
      await audio.play();
      if (!this.#isCurrentPlaybackOutput(audio, outputGeneration)) {
        this.#releasePlaybackElement(audio);
        return ctx.destination;
      }
      return destination;
    } catch (err) {
      console.warn("[VoiceClient] HTMLAudioElement playback output unavailable; using default AudioContext destination.", err);
      this.#closePlaybackOutput();
      this.#useDefaultPlaybackDestination = true;
      return ctx.destination;
    }
  }
  #isCurrentPlaybackOutput(audio, outputGeneration) {
    return this.#playbackElement === audio && this.#playbackOutputGeneration === outputGeneration;
  }
  async #applyOutputDevice(audio, generation) {
    const sinkId = this.#outputDeviceId;
    const setSinkId = audio.setSinkId;
    if (!setSinkId) {
      if (sinkId === "default") {
        this.#setOutputDeviceError(null);
        return;
      }
      this.#setOutputDeviceError(UNSUPPORTED_OUTPUT_DEVICE_ERROR);
      return;
    }
    try {
      await setSinkId.call(audio, sinkId);
      if (generation !== this.#outputDeviceSwitchGeneration || sinkId !== this.#outputDeviceId) {
        if (this.#playbackElement === audio) await this.#applyOutputDevice(audio, this.#outputDeviceSwitchGeneration);
        return;
      }
      if (this.#outputDeviceError === UNSUPPORTED_OUTPUT_DEVICE_ERROR || this.#outputDeviceError === OUTPUT_DEVICE_SWITCH_ERROR) this.#setOutputDeviceError(null);
    } catch {
      if (generation !== this.#outputDeviceSwitchGeneration || sinkId !== this.#outputDeviceId) {
        if (this.#playbackElement === audio) await this.#applyOutputDevice(audio, this.#outputDeviceSwitchGeneration);
        return;
      }
      this.#setOutputDeviceError(OUTPUT_DEVICE_SWITCH_ERROR);
    }
  }
  #closePlaybackOutput() {
    this.#playbackOutputGeneration++;
    if (this.#playbackElement) {
      this.#releasePlaybackElement(this.#playbackElement);
      this.#playbackElement = null;
    }
    this.#playbackDestination = null;
    this.#playbackDestinationPromise = null;
    this.#useDefaultPlaybackDestination = false;
  }
  #releasePlaybackElement(audio) {
    audio.pause();
    audio.srcObject = null;
  }
  async #playAudio(audioData, generation) {
    try {
      const ctx = await this.#getAudioContext();
      let audioBuffer;
      if (this.#audioFormat === "pcm16") {
        const int16 = new Int16Array(audioData);
        audioBuffer = ctx.createBuffer(1, int16.length, this.#sampleRate);
        const channel = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;
      } else audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
      if (generation !== this.#playbackGeneration) return;
      if (this.#playbackElement && this.#scheduledSources.size === 0 && this.#lastPlaybackEnd !== null && ctx.currentTime - this.#lastPlaybackEnd > 0.3) this.#closePlaybackOutput();
      const destination = await this.#getPlaybackDestination(ctx);
      if (generation !== this.#playbackGeneration) return;
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(destination);
      this.#scheduledSources.add(source);
      source.onended = () => {
        this.#scheduledSources.delete(source);
        if (generation === this.#playbackGeneration && !this.#isScheduling && this.#scheduledSources.size === 0 && this.#playbackQueue.length === 0) this.#isPlaying = false;
      };
      const startAt = Math.max(ctx.currentTime, this.#playbackCursor);
      this.#playbackCursor = startAt + audioBuffer.duration;
      this.#lastPlaybackEnd = this.#playbackCursor;
      source.start(startAt);
    } catch (err) {
      console.error("[VoiceClient] Audio playback error:", err);
    }
  }
  async #processPlaybackQueue() {
    if (this.#isScheduling || this.#playbackQueue.length === 0) return;
    this.#isScheduling = true;
    this.#isPlaying = true;
    const generation = this.#playbackGeneration;
    while (generation === this.#playbackGeneration && this.#playbackQueue.length > 0) {
      const audioData = this.#playbackQueue.shift();
      await this.#playAudio(audioData, generation);
    }
    if (generation === this.#playbackGeneration) {
      this.#isScheduling = false;
      if (this.#scheduledSources.size === 0) this.#isPlaying = false;
    }
  }
  #stopPlayback() {
    this.#playbackGeneration++;
    const sources = [...this.#scheduledSources];
    this.#scheduledSources.clear();
    for (const source of sources) try {
      source.stop();
    } catch {
    }
    this.#playbackQueue = [];
    this.#isPlaying = false;
    this.#isScheduling = false;
    this.#playbackCursor = 0;
    this.#lastPlaybackEnd = this.#audioContext ? this.#audioContext.currentTime : null;
  }
  async #startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: { ideal: 48e3 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } });
      this.#stream = stream;
      const ctx = await this.#getAudioContext();
      if (!this.#workletRegistered) {
        const blob = new Blob([WORKLET_PROCESSOR], { type: "application/javascript" });
        const workletUrl = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);
        this.#workletRegistered = true;
      }
      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, "audio-capture-processor");
      this.#workletNode = workletNode;
      workletNode.port.onmessage = (event) => {
        if (event.data.type === "audio" && !this.#isMuted) {
          const samples = event.data.samples;
          const rms = computeRMS(samples);
          const pcm = floatTo16BitPCM(samples);
          if (this.#transport?.connected) this.#transport.sendBinary(pcm);
          this.#processAudioLevel(rms);
        }
      };
      source.connect(workletNode);
      workletNode.connect(ctx.destination);
    } catch (err) {
      console.error("[VoiceClient] Mic error:", err);
      this.#error = "Microphone access denied. Please allow microphone access and try again.";
      this.#emit("error", this.#error);
    }
  }
  #stopMic() {
    this.#workletNode?.disconnect();
    this.#workletNode = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#resetDetection();
  }
  #processAudioLevel(rms) {
    if (this.#isMuted) return;
    this.#audioLevel = rms;
    this.#emit("audiolevelchange", rms);
    if (this.#isPlaying && rms > this.#interruptThreshold) {
      this.#interruptChunkCount++;
      if (this.#interruptChunkCount >= this.#interruptChunks) {
        this.#stopPlayback();
        this.#interruptChunkCount = 0;
        if (this.#transport?.connected) this.#transport.sendJSON({ type: "interrupt" });
      }
    } else this.#interruptChunkCount = 0;
    if (rms > this.#silenceThreshold) {
      if (!this.#isSpeaking) {
        this.#isSpeaking = true;
        if (this.#transport?.connected) this.#transport.sendJSON({ type: "start_of_speech" });
      }
      if (this.#silenceTimer) {
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = null;
      }
    } else if (this.#isSpeaking) {
      if (!this.#silenceTimer) this.#silenceTimer = setTimeout(() => {
        this.#isSpeaking = false;
        this.#silenceTimer = null;
        if (this.#transport?.connected) this.#transport.sendJSON({ type: "end_of_speech" });
      }, this.#silenceDurationMs);
    }
  }
  #resetDetection() {
    if (this.#silenceTimer) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
    this.#isSpeaking = false;
    this.#interruptChunkCount = 0;
    this.#audioLevel = 0;
    this.#emit("audiolevelchange", 0);
  }
};
export {
  VOICE_PROTOCOL_VERSION,
  VoiceClient,
  WebSocketVoiceTransport
};
