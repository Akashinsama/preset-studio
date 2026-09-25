/**
 * 芳乃 · 防截断运输（脚本层）　v1.0
 * ---------------------------------------------------------------------------
 * 干什么：拦截发往 api/backends/<后端名>/generate 的请求，往请求里塞一个合成的
 *        function-call，让模型把最终正文放进那个函数的 content 参数回传；再把
 *        finish_reason 由 "tool_calls" 改回 "stop"、剥掉 tool_calls。正文于是绕过
 *        「纯文本流被渠道掐断」那条路，从函数调用参数里完整落地。
 *        OpenAI 方言读 choices[].delta.tool_calls[].function.arguments，
 *        Google 方言读 candidates[].content.parts[].functionCall.args。
 *
 * 出处：从「芳乃预设 v2.8.1」那条 13.8 万字脚本里**原样抽出**的同一段
 *       （原作是 Kemini Dramatron v3.1 的 scripts[0]，作者 Kemini）。
 *       素材：_port/antitrunc-extracted.txt。移植前后逐项对照见
 *       spec/防截断移植对照.md —— 哪些搬来了、哪些没搬、为什么，都写在里面。
 *
 * 这段代码怎么进面板：panel/src/panel-core.js 里有一对
 *       FANO_ANTITRUNC_BEGIN/END 标记，tools/build-panel.mjs 把**这个文件整体**
 *       塞进那两个标记之间。所以：
 *         · 这里不写 import / export，也不要顶层副作用（只能是一个函数声明）；
 *         · 里面所有名字都活在 createAntiTruncation() 这个函数作用域里，
 *           不会和 panel-core.js 里的同名变量打架。
 *       PORTED-CORE 标记之间那一段由 _port/mk-antitrunc.mjs 从素材**机械搬入**，
 *       手改那一段会在下次跑那个脚本时被覆盖。
 *
 * 开关：读 localStorage 里调用方传进来的键（面板传 LS.antitrunc，即
 *       fano-antitrunc-v1 —— 与 v2.8.1 共用同一个键，换过来时开关状态不丢）。
 *       默认**开启**；只认 "1"/"0"/"true"/"false"，认不出来的值一律按开启。
 * 控制台：globalThis.__FANO_ANTITRUNC__（也是 v2.8.1 那边那套：
 *       isEnabled / enable / disable / lastRun / anchor / interceptor）。
 *       enable()/disable() 会连装/卸一起做，返回 { enabled, installed }。
 *
 * @param {object} [options]
 * @param {string} [options.key]      开关的 localStorage 键（默认 fano-antitrunc-v1）
 * @param {boolean} [options.defaultOn] 键不存在时算开还是关（默认 true）
 * @param {(msg:string)=>void} [options.onNotice] 渠道明显不支持时的提醒出口
 *        （面板传 notifyUser；不传就退回 toastr / 控制台。只提醒，绝不自动关开关）
 */
function createAntiTruncation(options) {
  'use strict';
  const opt = options || {};
  /** 开关的存档键。默认值与 v2.8.1 那边是同一个：换过来时用户的选择不会丢。 */
  const LS_KEY = String(opt.key || 'fano-antitrunc-v1');
  /** 键还没写过时的出厂默认（面板传 CONFIG.antitrunc.enabled）。 */
  const DEFAULT_ON = opt.defaultOn !== false;
  /** 提醒出口：面板会传自己的 notifyUser 进来；单独用时退回 toastr / 控制台。 */
  const notice = typeof opt.onNotice === 'function' ? opt.onNotice : defaultNotice;

  /** 默认提醒出口（不接面板时用）。 */
  function defaultNotice(msg) {
    try {
      if (typeof toastr !== 'undefined' && toastr && toastr.info) { toastr.info(msg); return; }
    } catch { /* 忽略 */ }
    try {
      const t = globalThis.toastr;
      if (t && t.info) { t.info(msg); return; }
    } catch { /* 忽略 */ }
    eventLog.info(msg);
  }

  /**
   * 宿主窗口 = 从当前窗口一路往上爬到**最外层的同源窗口**。
   *
   * 为什么不能只往上看一层（v2.8.1 那版写的是 window.parent ?? window）：
   *   酒馆助手脚本本身跑在 iframe 里，手机上还可能是**嵌套** iframe；而
   *   generate 请求是**最外层那个窗口**发的。只上一层就装到中间层去了，
   *   表现是"开关开着、却什么也没拦截到"。
   *   panel-core.js 里挂载点 HOST 用的是同一套爬法（那边踩过的坑是
   *   "只查 iframe 的 document"，于是面板渲染在看不见的框里）。
   *
   * 跨域（parent.document 抛异常）时返回 null：**宁可不装**，也不把拦截器装在
   * 一个根本不发请求的窗口上，然后让开关看起来是开着的。
   */
  function hostWindow() {
    try {
      let w = window;
      let depth = 0;
      while (w.parent && w.parent !== w) {
        const next = w.parent;
        void next.document;              /* 跨域在这里就会抛 */
        w = next;
        depth++;
        if (depth > 10) break;           /* 防御：不正常的嵌套 */
      }
      return w;
    } catch {
      return null;
    }
  }

  /* ══ PORTED-CORE-BEGIN ═══════════════════════════════════════════════ */
  const eventLog = (() => {
    const toText = (v) => {
      try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); }
    };
    const emit = (level, msg) => {
      const line = "[防截断] " + toText(msg);
      try {
        if (level === "warn") console.warn(line);
        else if (level === "error") console.error(line);
        else console.log(line);
      } catch { /* 控制台不可用时静默 */ }
    };
    return {
      info: (m) => emit("info", m),
      warn: (m) => emit("warn", m),
      error: (m) => emit("error", m),
      debug: (m) => emit("debug", m)
    };
  })();
  const TRANSPORT_CONTROL_ANCHOR = "<format>";
  const HIGH_SURROGATE_START = 55296;
  const HIGH_SURROGATE_END = 56319;
  const LOW_SURROGATE_START = 56320;
  const LOW_SURROGATE_END = 57343;
  const MAX_KEY_SCAN = 500;

  function readArgsContent(args) {
    if (typeof args === "string") {
      if (!args) return void 0;
      try {
        const value = JSON.parse(args).content;
        if (typeof value === "string") return value;
        return void 0;
      } catch {
        const decoder = new IncrementalContentDecoder();
        const salvaged = decoder.feed(args) + decoder.finish();
        if (!salvaged) return void 0;
        eventLog.warn("anti-truncation: transport arguments were cut off, salvaged what parsed");
        return salvaged;
      }
    }
    if (args && typeof args === "object") {
      const value = args.content;
      return typeof value === "string" ? value : void 0;
    }
    return void 0;
  }
  function describeError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function resolveUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input === "object" && "url" in input) {
        const url = input.url;
        return typeof url === "string" ? url : void 0;
      }
    } catch {
    }
    return void 0;
  }
  async function readRequestBody(args) {
    const [input, init] = args;
    if (init?.body !== void 0 && init.body !== null) {
      return typeof init.body === "string" ? init.body : void 0;
    }
    if (input instanceof Request) {
      return await input.clone().text();
    }
    return void 0;
  }
  function withBody(args, body) {
    const [input, init] = args;
    if (init?.body !== void 0 && init.body !== null) {
      return [input, { ...init, body }];
    }
    if (input instanceof Request) {
      return [new Request(input, { body }), init];
    }
    return args;
  }
  const EMPTY_RUN = {
    decodedChars: 0,
    emittedChars: 0,
    decodedChunks: 0,
    streamed: false,
    endedCleanly: false,
    conflict: false,
    plainWon: false
  };

  class IncrementalContentDecoder {
    state = "init";
    keyScan = "";
    /** An escape sequence cut in half by a fragment boundary. */
    pendingEscape = "";
    /** A quote held back because we cannot yet tell if it closes the string. */
    pendingQuote = false;
    highSurrogate = 0;
    emittedAny = false;
    get hasEmitted() {
      return this.emittedAny;
    }
    get isComplete() {
      return this.state === "completed";
    }
    /** Feed one raw fragment; returns the text that is now safe to show. */
    feed(fragment) {
      if (!fragment) return "";
      let out = "";
      let source = fragment;
      if (this.pendingQuote) {
        this.pendingQuote = false;
        const rest = source.replace(/^[\s]*/, "");
        if (rest.startsWith("}") || rest === "") {
          this.state = "completed";
          return "";
        }
        out += '"';
      }
      if (this.pendingEscape) {
        source = this.pendingEscape + source;
        this.pendingEscape = "";
      }
      let i = 0;
      while (i < source.length) {
        const char = source[i];
        switch (this.state) {
          case "init":
            if (char === "{" || char === '"') {
              this.state = "lookingForKey";
              if (char === '"') this.keyScan = '"';
            }
            i += 1;
            break;
          case "lookingForKey":
            this.keyScan += char;
            i += 1;
            if (this.keyScan.includes('"content"')) {
              this.state = "lookingForColon";
              this.keyScan = "";
            } else if (this.keyScan.length > MAX_KEY_SCAN) {
              this.state = "error";
            }
            break;
          case "lookingForColon":
            if (char === ":") this.state = "lookingForQuote";
            i += 1;
            break;
          case "lookingForQuote":
            if (char === '"') {
              this.state = "inString";
            } else if (!/\s/.test(char)) {
              this.state = "error";
            }
            i += 1;
            break;
          case "inString": {
            const consumed = this.consumeStringChar(source, i);
            out += consumed.text;
            if (consumed.stop) {
              i = source.length;
            } else {
              i += consumed.width;
            }
            break;
          }
          case "completed": {
            const rest = source.slice(i).trim();
            if (rest !== "" && rest !== "}" && rest !== "},") {
              this.state = "inString";
              break;
            }
            i = source.length;
            break;
          }
          case "error":
            i = source.length;
            break;
        }
      }
      if (out) this.emittedAny = true;
      return out;
    }
    /**
     * Consume one logical character of the JSON string starting at `index`.
     *
     * `stop` means the rest of this fragment must not be processed — either the string ended
     * or an incomplete tail was stashed for the next fragment.
     */
    consumeStringChar(source, index) {
      const char = source[index];
      if (char === "\\") {
        const next = source[index + 1];
        if (next === void 0) {
          this.pendingEscape = "\\";
          return { text: "", width: 0, stop: true };
        }
        if (next === "u") {
          const hex = source.slice(index + 2, index + 6);
          if (hex.length < 4) {
            this.pendingEscape = source.slice(index);
            return { text: "", width: 0, stop: true };
          }
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) {
            return { text: `\\u${hex}`, width: 6, stop: false };
          }
          if (code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END) {
            this.highSurrogate = code;
            return { text: "", width: 6, stop: false };
          }
          if (code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END && this.highSurrogate) {
            const combined = 65536 + (this.highSurrogate - HIGH_SURROGATE_START << 10) + (code - LOW_SURROGATE_START);
            this.highSurrogate = 0;
            return { text: String.fromCodePoint(combined), width: 6, stop: false };
          }
          return { text: String.fromCharCode(code), width: 6, stop: false };
        }
        const simple = SIMPLE_ESCAPES[next];
        if (simple !== void 0) {
          return { text: simple, width: 2, stop: false };
        }
        return { text: char + next, width: 2, stop: false };
      }
      if (char === '"') {
        const rest = source.slice(index + 1);
        if (rest === "") {
          this.pendingQuote = true;
          return { text: "", width: 0, stop: true };
        }
        if (rest.replace(/^[\s]*/, "").startsWith("}")) {
          this.state = "completed";
          return { text: "", width: 0, stop: true };
        }
        return { text: '"', width: 1, stop: false };
      }
      return { text: char, width: 1, stop: false };
    }
    /**
     * Flush whatever is still held back once the stream is over.
     *
     * A dangling escape is emitted verbatim: showing the user a stray backslash is better
     * than silently dropping characters they paid for.
     */
    finish() {
      let out = "";
      if (this.pendingQuote && !this.emittedAny) {
        out += '"';
      }
      this.pendingQuote = false;
      if (this.pendingEscape) {
        out += this.pendingEscape;
        this.pendingEscape = "";
      }
      if (out) this.emittedAny = true;
      return out;
    }
  }
  const SIMPLE_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "	"
  };
  class JsonArrayStreamSplitter {
    buffer = "";
    /** How far into `buffer` the scan has already reached. */
    at = 0;
    /** Offset where the element currently being scanned began. */
    start = 0;
    depth = 0;
    inElement = false;
    inString = false;
    escaped = false;
    opened = false;
    closed = false;
    /** True once the closing `]` arrived, i.e. the array was complete rather than cut off. */
    get complete() {
      return this.closed;
    }
    /** Feed raw text; returns every top-level element that is now whole. */
    push(text) {
      if (!text) return [];
      this.buffer += text;
      const elements = [];
      while (this.at < this.buffer.length) {
        const char = this.buffer[this.at];
        if (this.closed) {
          this.at += 1;
          continue;
        }
        if (!this.inElement) {
          if (!this.opened) {
            if (char === "[") {
              this.opened = true;
              this.at += 1;
              continue;
            }
            if (isSpace(char)) {
              this.at += 1;
              continue;
            }
            this.opened = true;
            continue;
          }
          if (isSpace(char) || char === ",") {
            this.at += 1;
            continue;
          }
          if (char === "]") {
            this.closed = true;
            this.at += 1;
            continue;
          }
          this.inElement = true;
          this.start = this.at;
          this.depth = 0;
        }
        if (this.inString) {
          if (this.escaped) this.escaped = false;
          else if (char === "\\") this.escaped = true;
          else if (char === '"') this.inString = false;
        } else if (char === '"') {
          this.inString = true;
        } else if (char === "{" || char === "[") {
          this.depth += 1;
        } else if (char === "}" || char === "]") {
          this.depth -= 1;
          if (this.depth === 0) {
            elements.push(this.buffer.slice(this.start, this.at + 1));
            this.inElement = false;
            this.buffer = this.buffer.slice(this.at + 1);
            this.at = 0;
            continue;
          }
        }
        this.at += 1;
      }
      return elements;
    }
    /**
     * Whatever never formed a complete element.
     *
     * Emitted rather than dropped on a truncated stream: the characters arrived and were paid
     * for, and a half-object downstream is more honest than silence.
     */
    finish() {
      if (!this.inElement) return "";
      const rest = this.buffer.slice(this.start);
      this.inElement = false;
      this.buffer = "";
      this.at = 0;
      return rest;
    }
  }
  function isSpace(char) {
    return char === " " || char === "\n" || char === "\r" || char === "	";
  }
  function flattenJsonElement(element) {
    try {
      return JSON.stringify(JSON.parse(element));
    } catch {
      return element.replace(/[\r\n]+/g, " ");
    }
  }
  const TOOL_PREFIX = "emit_complete_response_";
  function matchesToolName(candidate, toolName) {
    if (typeof candidate !== "string" || !candidate || !toolName) return false;
    if (candidate === toolName) return true;
    return bareToolName(candidate) === toolName;
  }
  function bareToolName(candidate) {
    return candidate.slice(candidate.lastIndexOf(":") + 1);
  }
  const NO_CLIENT_TOOLS = new Set();
  function classifyToolName(candidate, toolName, clientToolNames = NO_CLIENT_TOOLS) {
    if (typeof candidate !== "string" || !candidate) return "client";
    if (matchesToolName(candidate, toolName)) return "own";
    const bare = bareToolName(candidate);
    if (clientToolNames.has(candidate) || clientToolNames.has(bare)) return "client";
    return bare.length > TOOL_PREFIX.length && bare.startsWith(TOOL_PREFIX) ? "foreign" : "client";
  }
  function randomToolName(existing) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const name = TOOL_PREFIX + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!existing.has(name)) return name;
    }
    throw new Error("could not generate a unique transport tool name");
  }
  function collectToolNames(tools) {
    const names = new Set();
    if (!Array.isArray(tools)) return names;
    for (const tool of tools) {
      const name = tool?.function?.name;
      if (typeof name === "string" && name) names.add(name);
    }
    return names;
  }
  function callerControlsTools(body) {
    const choice = body["tool_choice"];
    if (choice === "none") return "tools-disabled-by-caller";
    if (choice === "required") return "caller-forced-tool";
    if (choice && typeof choice === "object") return "caller-forced-tool";
    return void 0;
  }
  function buildToolDefinition(name) {
    return {
      type: "function",
      function: {
        name,
        description: "Emit the complete final user-visible reply exactly once. Put the entire reply in content and write no reply text outside this call.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The complete final reply shown to the user."
            }
          },
          required: ["content"]
        }
      }
    };
  }
  function buildControlPrompt(toolName) {
    return `Call the \`${toolName}\` function exactly once and put your complete final reply in its \`content\` argument. Do not write any of the final reply outside that call. Use any other available tools normally when they are needed.`;
  }
  function findAnchor(messages, anchor) {
    for (let index = 0; index < messages.length; index += 1) {
      const content = messages[index]?.content;
      if (typeof content === "string" && content.includes(anchor)) return index;
    }
    return -1;
  }
  function prepareRequest(rawBody, options = {}) {
    let body;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { kind: "bypass", reason: "unparseable" };
      }
      body = parsed;
    } catch {
      return { kind: "bypass", reason: "unparseable" };
    }
    const messages = body["messages"];
    if (!Array.isArray(messages) || messages.length === 0) {
      return { kind: "bypass", reason: "no-messages" };
    }
    const controlled = callerControlsTools(body);
    if (controlled) {
      return { kind: "bypass", reason: controlled };
    }
    const existingTools = Array.isArray(body["tools"]) ? [...body["tools"]] : [];
    const clientToolNames = collectToolNames(existingTools);
    const toolName = randomToolName(clientToolNames);
    body["tools"] = [...existingTools, buildToolDefinition(toolName)];
    body["tool_choice"] = "auto";
    const control = buildControlPrompt(toolName);
    const anchorIndex = options.controlAnchor ? findAnchor(messages, options.controlAnchor) : -1;
    let controlPlacement;
    if (anchorIndex >= 0) {
      body["messages"] = [
        ...messages.slice(0, anchorIndex),
        { role: "system", content: control },
        ...messages.slice(anchorIndex)
      ];
      controlPlacement = "anchored";
    } else {
      const lastRole = messages[messages.length - 1]?.role;
      const controlRole = lastRole === "assistant" ? "user" : "system";
      body["messages"] = [...messages, { role: controlRole, content: control }];
      controlPlacement = "appended";
    }
    return {
      kind: "prepared",
      prepared: {
        body: JSON.stringify(body),
        toolName,
        clientToolNames,
        streamRequested: body["stream"] === true,
        controlPlacement
      }
    };
  }
  class SseContentRewriter {
    constructor(toolName, clientToolNames = new Set()) {
      this.toolName = toolName;
      this.clientToolNames = clientToolNames;
    }
    states = new Map();
    stats = {
      syntheticSeen: false,
      contentConflict: false,
      plainWon: false,
      sawDone: false,
      decodedChars: 0,
      emittedChars: 0,
      decodedChunks: 0
    };
    /** Echoed back on a synthesized final chunk so it matches the rest of the stream. */
    lastChunkMeta = {
      id: "chatcmpl-anti-truncation",
      model: "unknown",
      created: Math.floor(Date.now() / 1e3)
    };
    state(index, dialect) {
      let existing = this.states.get(index);
      if (!existing) {
        existing = {
          dialect,
          plain: "",
          sent: "",
          channels: new Map(),
          slotNames: new Map(),
          activeGoogleChannel: void 0,
          sawSynthetic: false
        };
        this.states.set(index, existing);
      }
      existing.dialect = dialect;
      return existing;
    }
    /**
     * Transform one SSE `data:` payload.
     *
     * Returns the replacement payload, or `undefined` when the chunk carried nothing left to
     * forward (for example a tool-call fragment that decoded to no visible characters yet).
     */
    transformPayload(payload) {
      const trimmed = payload.trim();
      if (trimmed === "[DONE]") {
        this.stats.sawDone = true;
        return payload;
      }
      let chunk;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") return payload;
        chunk = parsed;
      } catch {
        return payload;
      }
      if (typeof chunk["id"] === "string") this.lastChunkMeta.id = chunk["id"];
      if (typeof chunk["model"] === "string") this.lastChunkMeta.model = chunk["model"];
      if (typeof chunk["created"] === "number") this.lastChunkMeta.created = chunk["created"];
      const choices = chunk["choices"];
      if (Array.isArray(choices)) return this.rewriteChoices(chunk, choices, payload);
      const candidates = chunk["candidates"];
      if (Array.isArray(candidates)) return this.rewriteCandidates(chunk, candidates, payload);
      return payload;
    }
    /** The OpenAI dialect: `choices[].delta.tool_calls[].function.arguments`. */
    rewriteChoices(chunk, choices, payload) {
      let touched = false;
      let anythingToSend = false;
      for (const rawChoice of choices) {
        if (!rawChoice || typeof rawChoice !== "object") continue;
        const choice = rawChoice;
        const index = typeof choice["index"] === "number" ? choice["index"] : 0;
        const state = this.state(index, "openai");
        const field = choice["delta"] === void 0 || choice["delta"] === null ? choice["message"] && typeof choice["message"] === "object" ? "message" : "delta" : "delta";
        const delta = choice[field] ?? {};
        const originalContent = typeof delta["content"] === "string" ? delta["content"] : "";
        let streamedText = "";
        const toolCalls = delta["tool_calls"];
        if (Array.isArray(toolCalls)) {
          const { handled, decoded, remaining } = this.consumeToolCalls(state, toolCalls);
          streamedText += decoded;
          if (handled) touched = true;
          if (remaining.length > 0) {
            delta["tool_calls"] = remaining;
            anythingToSend = true;
          } else if (toolCalls.length > 0 && handled) {
            delete delta["tool_calls"];
            touched = true;
          }
        }
        if (originalContent) {
          touched = true;
          delete delta["content"];
          state.plain += originalContent;
        }
        if (streamedText) {
          delta["content"] = streamedText;
          anythingToSend = true;
        }
        const finish = choice["finish_reason"];
        if (finish !== null && finish !== void 0) {
          touched = true;
          anythingToSend = true;
          const tail = this.finalizeChoice(state);
          if (tail) {
            delta["content"] = (delta["content"] ?? "") + tail;
          }
          if (state.sawSynthetic && finish === "tool_calls") {
            choice["finish_reason"] = "stop";
          }
        }
        if (Object.keys(delta).length > 0) anythingToSend = true;
        choice[field] = delta;
      }
      if (!touched) return payload;
      if (!anythingToSend) return void 0;
      return JSON.stringify(chunk);
    }
    /**
     * The Google dialect: `candidates[].content.parts[].functionCall.args`.
     *
     * The recovered reply is emitted as a `parts[]` text entry, and it must come FIRST.
     * SillyTavern reads a Gemini chunk as `parts.filter(p => !p.thought).map(p => p.text)[0]`
     * (`public/scripts/openai.js`, `getStreamingReply`), so any other non-thought part left in
     * front of ours — an `inlineData` image, say — would shadow it and the reply would vanish.
     */
    rewriteCandidates(chunk, candidates, payload) {
      let touched = false;
      let anythingToSend = false;
      for (const rawCandidate of candidates) {
        if (!rawCandidate || typeof rawCandidate !== "object") continue;
        const candidate = rawCandidate;
        const index = typeof candidate["index"] === "number" ? candidate["index"] : 0;
        const state = this.state(index, "google");
        const rawContent = candidate["content"];
        const content = rawContent && typeof rawContent === "object" ? rawContent : {};
        const parts = content["parts"];
        let streamedText = "";
        const kept = [];
        if (Array.isArray(parts)) {
          for (const rawPart of parts) {
            if (!rawPart || typeof rawPart !== "object") {
              kept.push(rawPart);
              continue;
            }
            const part = rawPart;
            const call = part["functionCall"];
            if (call && typeof call === "object") {
              const consumed = this.consumeGoogleCall(state, call);
              if (!consumed.handled) {
                kept.push(rawPart);
                continue;
              }
              streamedText += consumed.decoded;
              touched = true;
              continue;
            }
            if (part["thought"] === true) {
              kept.push(rawPart);
              continue;
            }
            if (typeof part["text"] === "string" && part["text"]) {
              touched = true;
              state.plain += part["text"];
              continue;
            }
            kept.push(rawPart);
          }
        }
        let emitted = streamedText;
        const finish = candidate["finishReason"];
        if (finish !== null && finish !== void 0) {
          touched = true;
          anythingToSend = true;
          emitted += this.finalizeChoice(state);
        }
        if (!touched) continue;
        const nextParts = [];
        if (emitted) nextParts.push({ text: emitted });
        nextParts.push(...kept);
        if (nextParts.length > 0 || Array.isArray(parts)) {
          content["parts"] = nextParts;
          if (typeof content["role"] !== "string") content["role"] = "model";
          candidate["content"] = content;
        }
        if (nextParts.length > 0) anythingToSend = true;
      }
      if (!touched) return payload;
      if (!anythingToSend) return void 0;
      return JSON.stringify(chunk);
    }
    /**
     * Consume one Google `functionCall` block, in either of the two shapes it arrives in.
     *
     * ── Atomic ───────────────────────────────────────────────────────────────────────────
     * `{ name, args }` — the whole call in one block. What Gemini sends by default.
     *
     * ── Streamed (`streamFunctionCallArguments: true`) ───────────────────────────────────
     * The call is spread over several blocks and only the FIRST carries the name:
     *
     *   `{ name, id, willContinue: true }`                       ← opening, no arguments yet
     *   `{ partialArgs: [{ jsonPath: "$.content", stringValue }], willContinue: true }`
     *   `{ partialArgs: [{ jsonPath: "$.content" }] }`           ← end-of-argument marker
     *   `{}`                                                     ← end-of-call marker
     *
     * Every block after the first is anonymous, so `classifyToolName` cannot be asked again —
     * hence the latch. Without it those blocks read as somebody else's tool call and get
     * forwarded to a SillyTavern that finds no text in them: an empty message, with the whole
     * reply sitting in the fragments we just passed along.
     *
     * `stringValue` is DECODED text, not JSON source, so it must never reach
     * `IncrementalContentDecoder` — that one exists to read a raw `{"content":"…"}` string
     * while it is still arriving, which is a different problem.
     *
     * Malformed fragments are skipped rather than thrown on. The gateway-side reference
     * implementation throws; this one sits in front of a user's chat and must never turn a
     * degraded reply into a failed generation.
     */
    consumeGoogleCall(state, call) {
      const name = call["name"];
      let channelName;
      if (typeof name === "string" && name) {
        if (classifyToolName(name, this.toolName, this.clientToolNames) === "client") {
          state.activeGoogleChannel = void 0;
          return { handled: false, decoded: "" };
        }
        channelName = bareToolName(name);
        state.activeGoogleChannel = channelName;
      } else {
        channelName = state.activeGoogleChannel;
      }
      if (channelName === void 0) {
        const empty = call["args"] === void 0 && call["partialArgs"] === void 0 && state.sawSynthetic;
        return { handled: empty, decoded: "" };
      }
      this.markSynthetic(state);
      const channel = this.channel(state, channelName);
      let text = "";
      const partialArgs = call["partialArgs"];
      if (Array.isArray(partialArgs)) {
        text += readPartialArgs(partialArgs);
      }
      if (call["args"] !== void 0) {
        text += decodeGoogleArgs(channel, call["args"]);
      }
      if (call["willContinue"] !== true) {
        state.activeGoogleChannel = void 0;
      }
      return { handled: true, decoded: this.absorb(state, channel, text) };
    }
    /** First sight of a transport tool on this choice. */
    markSynthetic(state) {
      if (state.sawSynthetic) return;
      state.sawSynthetic = true;
      this.stats.syntheticSeen = true;
    }
    channel(state, name) {
      let channel = state.channels.get(name);
      if (!channel) {
        channel = { decoder: new IncrementalContentDecoder(), text: "" };
        state.channels.set(name, channel);
      }
      return channel;
    }
    /**
     * Record newly decoded transport text, and return the part that may go out right now.
     *
     * While a transport call is the only thing that has produced anything, its text streams as
     * it arrives — that progressive display is the whole point of the feature. The moment a
     * SECOND candidate exists (ordinary text the model wrote anyway, or another transport tool
     * because a gateway injected its own), streaming stops for this choice and the decision is
     * deferred to `finalizeChoice`, which sends the winner exactly once. Deferring costs the
     * progressive display only in the case that used to lose the reply outright.
     */
    absorb(state, channel, text) {
      if (!text) return "";
      channel.text += text;
      this.stats.decodedChunks += 1;
      if (state.plain !== "" || state.channels.size > 1) return "";
      state.sent += text;
      this.stats.decodedChars += text.length;
      this.stats.emittedChars += text.length;
      return text;
    }
    /**
     * Split a `tool_calls` delta into decoded transport text and the genuine calls that must
     * still be forwarded.
     */
    consumeToolCalls(state, toolCalls) {
      let handled = false;
      let decoded = "";
      const remaining = [];
      for (const rawCall of toolCalls) {
        if (!rawCall || typeof rawCall !== "object") {
          remaining.push(rawCall);
          continue;
        }
        const call = rawCall;
        const callIndex = typeof call["index"] === "number" ? call["index"] : 0;
        const fn = call["function"] ?? {};
        const name = typeof fn["name"] === "string" ? fn["name"] : "";
        let channelName = state.slotNames.get(callIndex);
        if (name) {
          const origin = classifyToolName(name, this.toolName, this.clientToolNames);
          if (origin === "client") {
            channelName = void 0;
            state.slotNames.delete(callIndex);
          } else {
            channelName = bareToolName(name);
            state.slotNames.set(callIndex, channelName);
          }
        }
        if (channelName === void 0) {
          remaining.push(rawCall);
          continue;
        }
        handled = true;
        this.markSynthetic(state);
        const channel = this.channel(state, channelName);
        const args = fn["arguments"];
        if (typeof args === "string" && args) {
          decoded += this.absorb(state, channel, channel.decoder.feed(args));
        }
      }
      return { handled, decoded, remaining };
    }
    /**
     * Decide which channel actually carried the reply, and return what still has to be sent.
     *
     * Longest wins, with a tie going to the transport call because that is the channel we
     * asked for. Anything already on screen cannot be recalled, so only the missing remainder
     * is emitted; a winner that is not a continuation of it is emitted whole, on the grounds
     * that showing a fragment twice beats not showing the reply at all.
     *
     * Idempotent: every accumulator is drained, so a second call (the `finish_reason` chunk
     * followed by the stream closing) adds nothing.
     */
    finalizeChoice(state) {
      let best = "";
      let bestIsPlain = false;
      let contenders = 0;
      for (const channel of state.channels.values()) {
        channel.text += channel.decoder.finish();
        if (channel.text) contenders += 1;
        if (channel.text.length > best.length) {
          best = channel.text;
          bestIsPlain = false;
        }
        channel.text = "";
      }
      if (state.plain) {
        contenders += 1;
        if (state.plain.length > best.length) {
          best = state.plain;
          bestIsPlain = true;
        }
      }
      state.plain = "";
      if (contenders > 1) {
        this.stats.contentConflict = true;
        if (bestIsPlain) this.stats.plainWon = true;
      }
      const tail = best.startsWith(state.sent) ? best.slice(state.sent.length) : best;
      state.sent += tail;
      this.stats.emittedChars += tail.length;
      if (!bestIsPlain) this.stats.decodedChars += tail.length;
      return tail;
    }
    /**
     * Release anything still held back, for a stream that ended without a `finish_reason`.
     *
     * Text is buffered until the winning channel is known, so a stream that simply stops — no
     * finish chunk, connection dropped, provider quirk — would otherwise take the entire reply
     * down with it. Returns one payload per choice that still owes the client text; the caller
     * writes them out before closing.
     */
    finalizePending() {
      const { id, model, created } = this.lastChunkMeta;
      const payloads = [];
      for (const [index, state] of this.states) {
        const pending = this.finalizeChoice(state);
        if (!pending) continue;
        payloads.push(
          state.dialect === "google" ? JSON.stringify({
            candidates: [
              { index, content: { role: "model", parts: [{ text: pending }] } }
            ]
          }) : JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index, delta: { content: pending }, finish_reason: null }]
          })
        );
      }
      return payloads;
    }
  }
  function readPartialArgs(partialArgs) {
    let text = "";
    for (const rawFragment of partialArgs) {
      if (!rawFragment || typeof rawFragment !== "object") continue;
      const fragment = rawFragment;
      const path = typeof fragment["jsonPath"] === "string" ? fragment["jsonPath"].trim() : "";
      if (path !== "$.content") continue;
      const value = fragment["stringValue"];
      if (typeof value === "string") text += value;
    }
    return text;
  }
  function decodeGoogleArgs(channel, args) {
    if (typeof args === "string") return args ? channel.decoder.feed(args) : "";
    if (args && typeof args === "object") {
      const content = args["content"];
      if (typeof content !== "string" || !content) return "";
      if (!channel.text) return content;
      if (content.startsWith(channel.text)) return content.slice(channel.text.length);
      if (channel.text.startsWith(content)) return "";
      return content;
    }
    return "";
  }
  const MARKER = "__keminiAntiTruncation__";
  const SOFT_MISS_LIMIT = 3;
  let onTransportIncompatible = () => {
  };
  function setTransportIncompatibleHandler(handler) {
    onTransportIncompatible = handler;
  }
  const GENERATION_ENDPOINT = /\/api\/backends\/[^/]+\/generate\b/;
  class AntiTruncationInterceptor {
    installed = false;
    enabled = false;
    original;
    target;
    lastRunRecord;
    get isEnabled() {
      return this.enabled;
    }
    get lastRun() {
      return this.lastRunRecord;
    }
    /** Consecutive runs where the channel gave nothing back through the tool. */
    missStreak = 0;
    record(run) {
      this.lastRunRecord = { at: Date.now(), ...run };
      eventLog.info(
        `anti-truncation: ${run.outcome}` + (run.detail ? ` (${run.detail})` : "") + (run.outcome !== "transported" ? "" : run.plainWon ? ` — plain channel won with ${run.emittedChars} chars` : ` — ${run.decodedChars} chars in ${run.decodedChunks} chunks`)
      );
      this.warnIfChannelRejectsTransport(run.outcome, run.detail);
      this.warnIfChannelHasItsOwnTransport(run.outcome, run.plainWon);
    }
    /** Consecutive runs the ordinary text channel won. */
    plainWinStreak = 0;
    /**
     * Say when a channel looks like it is already doing this itself.
     *
     * Two anti-truncation layers are not harmful — the longest-wins rule keeps the reply — but
     * they are redundant, and the layer we add costs a control prompt and a tool the model has
     * to reason about. Worth telling the user; not worth deciding for them.
     */
    warnIfChannelHasItsOwnTransport(outcome, plainWon) {
      if (outcome !== "transported") return;
      if (!plainWon) {
        this.plainWinStreak = 0;
        return;
      }
      this.plainWinStreak += 1;
      if (this.plainWinStreak === SOFT_MISS_LIMIT) {
        onTransportIncompatible(
          `连续 ${SOFT_MISS_LIMIT} 次正文都是从普通通道拿到的，这条渠道多半自己就做了抗截断。正文没有丢，但本面板这一层是多余的，可以点「🛡 防截断」把它关掉。`
        );
      }
    }
    /**
     * Say when a channel looks unable to carry the transport — and do nothing else.
     *
     * Auto-disabling was considered and rejected: a model can decline the tool once for its
     * own reasons, and a panel that silently reverses the user's switch is worse than one that
     * keeps failing visibly. So this only warns, once per streak, and the user decides.
     *
     * `upstream-error` is a hard rejection and worth saying immediately. `no-synthetic-call`
     * and a barren `non-stream` are soft: they need to repeat before they mean anything.
     */
    warnIfChannelRejectsTransport(outcome, detail) {
      if (outcome === "transported" || outcome === "bypassed") {
        this.missStreak = 0;
        return;
      }
      if (outcome === "upstream-error") {
        this.missStreak = 0;
        onTransportIncompatible(
          `上游拒绝了这次请求（${detail ?? "未知"}）。如果每次都这样，多半是这条渠道不接受函数调用，可以点「🛡 防截断」把它关掉。`
        );
        return;
      }
      this.missStreak += 1;
      if (this.missStreak === SOFT_MISS_LIMIT) {
        onTransportIncompatible(
          `连续 ${SOFT_MISS_LIMIT} 次没有从传输函数里拿到正文，这条渠道可能不支持。开关没有被动过——要关请点「🛡 防截断」。`
        );
      }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      eventLog.info(`anti-truncation transport ${enabled ? "enabled" : "disabled"}`);
    }
    install() {
      if (this.installed) return;
      /* 【移植改动】宿主窗口 = 一路往上爬到最外层的同源窗口，不再只看 parent 一层。
         酒馆助手脚本跑在 iframe 里（手机上还可能是嵌套 iframe），而 generate 请求
         是**最外层那个窗口**发的。取不到（跨域）就宁可不装——不把拦截器装在一个
         根本不发请求的窗口上，让开关看起来"开着"。 */
      const target = hostWindow();
      if (!target) {
        eventLog.warn("anti-truncation: 外层窗口跨域，拿不到宿主窗口，未安装");
        return;
      }
      const current = target.fetch;
      if (typeof current !== "function") {
        eventLog.warn("anti-truncation: 宿主窗口没有 fetch，未安装");
        return;
      }
      const original = current[MARKER]?.original ?? current;
      const self = this;
      const wrapper = function patchedFetch(...args) {
        if (!self.enabled) {
          return original.apply(this ?? target, args);
        }
        try {
          const url = resolveUrl(args[0]);
          if (url && GENERATION_ENDPOINT.test(url)) {
            return self.intercept(original, this ?? target, args);
          }
        } catch (error) {
          eventLog.warn(`anti-truncation: intercept skipped, ${describeError(error)}`);
        }
        return original.apply(this ?? target, args);
      };
      wrapper[MARKER] = { original };
      target.fetch = wrapper;
      this.original = original;
      this.target = target;
      this.installed = true;
      eventLog.info("anti-truncation interceptor installed");
    }
    async intercept(original, thisArg, args) {
      const call = () => original.apply(thisArg, args);
      let rawBody;
      try {
        rawBody = await readRequestBody(args);
      } catch (error) {
        this.record({
          ...EMPTY_RUN,
          outcome: "bypassed",
          detail: `读取请求体失败: ${describeError(error)}`
        });
        return call();
      }
      if (rawBody === void 0) {
        this.record({ ...EMPTY_RUN, outcome: "bypassed", detail: "请求体不是可读取的字符串" });
        return call();
      }
      const result = prepareRequest(rawBody, { controlAnchor: TRANSPORT_CONTROL_ANCHOR });
      if (result.kind === "bypass") {
        this.record({ ...EMPTY_RUN, outcome: "bypassed", detail: result.reason });
        return call();
      }
      const { body, toolName, clientToolNames, streamRequested, controlPlacement } = result.prepared;
      if (controlPlacement === "appended") {
        eventLog.warn(
          `anti-truncation: control anchor ${JSON.stringify(TRANSPORT_CONTROL_ANCHOR)} not found, control prompt appended at the end instead`
        );
      }
      const patched = withBody(args, body);
      const response = await original.apply(thisArg, patched);
      if (!response.ok || !response.body) {
        this.record({
          ...EMPTY_RUN,
          outcome: "upstream-error",
          detail: `HTTP ${response.status}`
        });
        return response;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const { shape, response: sniffed } = await sniffResponseShape(response, contentType);
      if (shape === "json-array" && streamRequested) {
        eventLog.info("anti-truncation: upstream sent a JSON array instead of SSE, reframing");
        return rewriteEventStream(reframeJsonArrayStream(sniffed), toolName, clientToolNames, (stats) => {
          this.record({
            outcome: stats.syntheticSeen ? "transported" : "no-synthetic-call",
            detail: "上游回的是 JSON 数组流，已转成 SSE",
            decodedChars: stats.decodedChars,
            emittedChars: stats.emittedChars,
            decodedChunks: stats.decodedChunks,
            streamed: stats.decodedChunks > 1,
            endedCleanly: stats.sawDone,
            conflict: stats.contentConflict,
            plainWon: stats.plainWon
          });
        });
      }
      if (shape !== "sse") {
        const { response: rewritten, recovered } = await rewriteJsonResponse(
          sniffed,
          toolName,
          clientToolNames
        );
        if (recovered !== void 0) {
          this.record({
            ...EMPTY_RUN,
            outcome: "transported",
            decodedChars: recovered.plainWon ? 0 : recovered.chars,
            emittedChars: recovered.chars,
            decodedChunks: 1,
            streamed: false,
            endedCleanly: true,
            conflict: recovered.conflict,
            plainWon: recovered.plainWon
          });
          return rewritten;
        }
        this.record({
          ...EMPTY_RUN,
          outcome: "non-stream",
          detail: (streamRequested ? `请求了流式但上游回的不是 SSE${contentType ? `（content-type: ${contentType}）` : ""}` : "本次请求没有开流式") + "，且没找到传输函数调用"
        });
        return rewritten;
      }
      return rewriteEventStream(sniffed, toolName, clientToolNames, (stats) => {
        this.record({
          outcome: stats.syntheticSeen ? "transported" : "no-synthetic-call",
          decodedChars: stats.decodedChars,
          emittedChars: stats.emittedChars,
          decodedChunks: stats.decodedChunks,
          // More than one carrying chunk is the proof that it arrived progressively.
          streamed: stats.decodedChunks > 1,
          endedCleanly: stats.sawDone,
          conflict: stats.contentConflict,
          plainWon: stats.plainWon
        });
      });
    }
    dispose() {
      this.enabled = false;
      if (!this.installed || !this.target || !this.original) {
        this.installed = false;
        return;
      }
      const current = this.target.fetch;
      if (current && current[MARKER]) {
        this.target.fetch = this.original;
        eventLog.info("anti-truncation interceptor removed");
      } else {
        eventLog.warn("anti-truncation: another patch is on top, leaving chain intact");
      }
      this.installed = false;
      this.target = void 0;
      this.original = void 0;
    }
  }
  const SSE_HEAD = /^\s*(?:data:|event:|id:|retry:|:)/;
  const JSON_ARRAY_HEAD = /^\s*\[/;
  const SNIFF_CHARS = 8;
  async function sniffResponseShape(response, contentType) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const consumed = [];
    let head = "";
    let ended = false;
    let readError;
    try {
      while (!ended && head.length < SNIFF_CHARS) {
        const { value, done } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        if (!value || value.length === 0) continue;
        consumed.push(value);
        head += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      readError = error;
      ended = true;
    }
    const replay = new ReadableStream({
      start(controller) {
        for (const value of consumed) controller.enqueue(value);
        if (readError !== void 0) {
          controller.error(readError);
          return;
        }
        if (ended) controller.close();
      },
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason);
      }
    });
    const shape = JSON_ARRAY_HEAD.test(head) ? "json-array" : SSE_HEAD.test(head) || contentType.includes("text/event-stream") ? "sse" : "json";
    return {
      shape,
      response: new Response(replay, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    };
  }
  function reframeJsonArrayStream(response) {
    const splitter = new JsonArrayStreamSplitter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const emit = (controller, element) => {
      controller.enqueue(encoder.encode(`data: ${flattenJsonElement(element)}

`));
    };
    const stream = new TransformStream({
      transform(chunk, controller) {
        for (const element of splitter.push(decoder.decode(chunk, { stream: true }))) {
          emit(controller, element);
        }
      },
      flush(controller) {
        for (const element of splitter.push(decoder.decode())) {
          emit(controller, element);
        }
        const rest = splitter.finish();
        if (rest.trim()) emit(controller, rest);
        if (splitter.complete) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } else {
          eventLog.warn("anti-truncation: JSON array stream ended without its closing bracket");
        }
      }
    });
    void response.body.pipeTo(stream.writable).catch((error) => {
      eventLog.warn(`anti-truncation: JSON array stream aborted, ${describeError(error)}`);
    });
    return new Response(stream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  function rewriteEventStream(response, toolName, clientToolNames, onComplete) {
    const rewriter = new SseContentRewriter(toolName, clientToolNames);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const stream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const rewritten = rewriteEvent(rewriter, rawEvent);
          if (rewritten !== void 0) {
            controller.enqueue(encoder.encode(rewritten + "\n\n"));
          }
          boundary = buffer.indexOf("\n\n");
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        const rest = buffer.trim();
        if (rest) {
          controller.enqueue(encoder.encode(buffer));
        }
        for (const payload of rewriter.finalizePending()) {
          controller.enqueue(encoder.encode(`data: ${payload}

`));
        }
        if (!rewriter.stats.sawDone) {
          eventLog.warn("anti-truncation: upstream stream ended without [DONE]");
        }
        onComplete?.(rewriter.stats);
      }
    });
    void response.body.pipeTo(stream.writable).catch((error) => {
      eventLog.warn(`anti-truncation: upstream stream aborted, ${describeError(error)}`);
    });
    return new Response(stream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  function rewriteEvent(rewriter, rawEvent) {
    const lines = rawEvent.split("\n");
    const out = [];
    let sawData = false;
    let emittedData = false;
    for (const line2 of lines) {
      if (!line2.startsWith("data:")) {
        out.push(line2);
        continue;
      }
      sawData = true;
      const payload = line2.slice("data:".length).replace(/^ /, "");
      const rewritten = rewriter.transformPayload(payload);
      if (rewritten !== void 0) {
        out.push(`data: ${rewritten}`);
        emittedData = true;
      }
    }
    if (sawData && !emittedData) return void 0;
    return out.join("\n");
  }
  async function rewriteJsonResponse(response, toolName, clientToolNames) {
    let parsed;
    try {
      parsed = await response.clone().json();
    } catch (error) {
      eventLog.warn(`anti-truncation: response was not JSON, ${describeError(error)}`);
      return { response, recovered: void 0 };
    }
    let recovered;
    try {
      const choices = parsed["choices"];
      if (Array.isArray(choices)) {
        recovered = unwrapOpenAiChoices(choices, toolName, clientToolNames);
      }
      const google = unwrapGoogleContent(parsed, toolName, clientToolNames);
      if (google !== void 0) recovered = mergeRecovery(recovered, google);
    } catch (error) {
      eventLog.warn(`anti-truncation: could not unwrap JSON reply, ${describeError(error)}`);
      return { response, recovered: void 0 };
    }
    if (recovered === void 0) return { response, recovered };
    return {
      response: new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      recovered
    };
  }
  function mergeRecovery(a, b) {
    if (!a) return b;
    return {
      chars: a.chars + b.chars,
      conflict: a.conflict || b.conflict,
      plainWon: a.plainWon || b.plainWon
    };
  }
  function longest(plain, carried) {
    let text = plain;
    let plainWon = true;
    for (const candidate of carried) {
      if (candidate.length >= text.length) {
        text = candidate;
        plainWon = false;
      }
    }
    const contenders = (plain ? 1 : 0) + carried.filter((entry) => entry !== "").length;
    return {
      text,
      chars: text.length,
      conflict: contenders > 1,
      plainWon: plainWon && contenders > 1
    };
  }
  function unwrapOpenAiChoices(choices, toolName, clientToolNames) {
    let recovered;
    for (const rawChoice of choices) {
      const choice = rawChoice;
      const message = choice["message"];
      if (!message) continue;
      const calls = message["tool_calls"];
      if (!Array.isArray(calls)) continue;
      const kept = [];
      const carried = [];
      for (const rawCall of calls) {
        const fn = rawCall?.function;
        if (fn && classifyToolName(fn["name"], toolName, clientToolNames) !== "client") {
          const value = readArgsContent(fn["arguments"]);
          if (typeof value === "string") {
            carried.push(value);
            continue;
          }
        }
        kept.push(rawCall);
      }
      if (carried.length === 0) continue;
      const plain = typeof message["content"] === "string" ? message["content"] : "";
      const best = longest(plain, carried);
      message["content"] = best.text;
      recovered = mergeRecovery(recovered, best);
      if (kept.length > 0) {
        message["tool_calls"] = kept;
      } else {
        delete message["tool_calls"];
        if (choice["finish_reason"] === "tool_calls") choice["finish_reason"] = "stop";
      }
    }
    return recovered;
  }
  function unwrapGoogleContent(parsed, toolName, clientToolNames) {
    const rawContent = parsed["responseContent"];
    if (!rawContent || typeof rawContent !== "object") return void 0;
    const content = rawContent;
    const parts = content["parts"];
    if (!Array.isArray(parts)) return void 0;
    const kept = [];
    const carried = [];
    let plain = "";
    let signature;
    for (const rawPart of parts) {
      const part = rawPart;
      const call = part?.["functionCall"];
      if (call && classifyToolName(call["name"], toolName, clientToolNames) !== "client") {
        const value = readArgsContent(call["args"]);
        if (typeof value === "string") {
          carried.push(value);
          if (part?.["thoughtSignature"] !== void 0) signature = part["thoughtSignature"];
          continue;
        }
      }
      if (part && part["thought"] !== true && typeof part["text"] === "string" && part["text"]) {
        plain += part["text"];
        if (signature === void 0 && part["thoughtSignature"] !== void 0) {
          signature = part["thoughtSignature"];
        }
        continue;
      }
      kept.push(rawPart);
    }
    if (carried.length === 0) return void 0;
    const choices = parsed["choices"];
    const message = Array.isArray(choices) ? choices[0]?.message : void 0;
    const wrapped = typeof message?.["content"] === "string" ? message["content"] : "";
    const best = longest(plain.length >= wrapped.length ? plain : wrapped, carried);
    const textPart = { text: best.text };
    if (signature !== void 0) textPart["thoughtSignature"] = signature;
    content["parts"] = [textPart, ...kept];
    if (message) message["content"] = best.text;
    return best;
  }
  /* ══ PORTED-CORE-END ═════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════════
   * 引导层：开关的读写 / 装与卸 / 控制台 API
   *
   * 与 v2.8.1 那版引导层的差别（就这一处，其余照搬）：
   *   它那版还负责**注册顶部按钮**（appendInexistentScriptButtons /
   *   getButtonEvent / eventOn）。这里**故意不注册**：panel-core.js 已经静态声明
   *   并接线了那两个按钮，两处都注册就会把一次点击变成两次切换（＝点一下没反应，
   *   而且每点一次多挂一个监听）。按钮交给面板，这里只负责开关本身。
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * 读开关。三种历史写法都要认：
   *   "1" / "0"       —— v2.8.1 那一支写的就是这个（键也是它留下的）
   *   "true"/"false"  —— 本面板上一版的按钮用 JSON.stringify 写的是这个
   *   键不存在        —— 用出厂默认（options.defaultOn，面板传 CONFIG.antitrunc.enabled）
   * 认不出来的脏值一律按**开启**：宁可多一层防护，也不因为一个坏值把防护悄悄关掉。
   */
  function readSwitch() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw === null || raw === '') return DEFAULT_ON;
      const v = String(raw).trim().toLowerCase();
      if (v === '0' || v === 'false') return false;
      return true;
    } catch {
      return DEFAULT_ON;   /* 无痕模式 / 取不到 localStorage：用出厂默认 */
    }
  }

  /**
   * 写开关。写成 "1"/"0"——那是**这个键的原主人**（v2.8.1）认的写法，
   * 于是从这支换回那一支时，用户的选择也跟着过去。
   */
  function writeSwitch(on) {
    try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch { /* 配额满 / 无痕：不阻断面板 */ }
  }

  const interceptor = new AntiTruncationInterceptor();
  /* 渠道明显不支持时只提醒，绝不自动关用户的开关（核心段的注释里写了为什么）。 */
  setTransportIncompatibleHandler((msg) => notice(msg));

  /**
   * 切开关：写存档 + **真的**装/卸拦截器（不是只改一个标志位）。
   * 返回 { enabled, installed }：installed=false 表示"开关记下了，但没装上"
   * （外层窗口跨域，或那个窗口没有 fetch），调用方据此提示用户。
   */
  function setEnabled(next) {
    const on = next !== false;
    writeSwitch(on);
    if (on) {
      interceptor.install();
      interceptor.setEnabled(true);
    } else {
      interceptor.setEnabled(false);
      interceptor.dispose();     /* 关掉就把 window.fetch 上的包装整个摘掉 */
    }
    return { enabled: interceptor.isEnabled, installed: interceptor.installed };
  }

  const api = {
    interceptor,
    key: LS_KEY,
    isEnabled: () => interceptor.isEnabled,
    installed: () => interceptor.installed,
    lastRun: () => interceptor.lastRun,
    anchor: TRANSPORT_CONTROL_ANCHOR,
    setEnabled,
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
    read: readSwitch,
    write: writeSwitch,
    hostWindow,
  };

  /** 控制台 API：挂在本脚本的 globalThis 上；够得着的话再挂到宿主窗口上。 */
  try { globalThis.__FANO_ANTITRUNC__ = api; } catch { /* 忽略 */ }
  try {
    const w = hostWindow();
    if (w && w !== globalThis) w.__FANO_ANTITRUNC__ = api;
  } catch { /* 跨域等：忽略 */ }

  /* 启动时按开关决定装不装：关着就一个包装都不留（window.fetch 原样）。
     注意传进来的键也在这儿被规范化一次（老值 "true" 会被写成 "1"）。 */
  const started = setEnabled(readSwitch());
  eventLog.info('防截断运输已装载，开关=' + (started.enabled ? '开' : '关')
    + (started.enabled && !started.installed ? '（⚠ 拦截器没装上：拿不到宿主窗口的 fetch）' : ''));

  return api;
}
