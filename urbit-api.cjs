/* 

PATCHED 2023-12-7

Comments out a line that throws a login error when the return status is
anything between 200 and 300. This is a problem because the server returns
204, which is a valid status code for a successful login with nodejs.

*/

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

class ResumableError extends Error {}
class FatalError extends Error {}
class ReapError extends Error {}

var lib = {};

Object.defineProperty(lib, "__esModule", {
  value: true,
});

var _typeof =
  typeof Symbol === "function" && typeof Symbol.iterator === "symbol"
    ? function (obj) {
        return typeof obj;
      }
    : function (obj) {
        return obj &&
          typeof Symbol === "function" &&
          obj.constructor === Symbol &&
          obj !== Symbol.prototype
          ? "symbol"
          : typeof obj;
      };

/* global window self */

var isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

/* eslint-disable no-restricted-globals */
var isWebWorker =
  (typeof self === "undefined" ? "undefined" : _typeof(self)) === "object" &&
  self.constructor &&
  self.constructor.name === "DedicatedWorkerGlobalScope";
/* eslint-enable no-restricted-globals */

var isNode =
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;

/**
 * @see https://github.com/jsdom/jsdom/releases/tag/12.0.0
 * @see https://github.com/jsdom/jsdom/issues/1537
 */
/* eslint-disable no-undef */
var isJsDom = function isJsDom() {
  return (
    (typeof window !== "undefined" && window.name === "nodejs") ||
    navigator.userAgent.includes("Node.js") ||
    navigator.userAgent.includes("jsdom")
  );
};

var isBrowser_1 = (lib.isBrowser = isBrowser);
lib.isWebWorker = isWebWorker;
lib.isNode = isNode;
lib.isJsDom = isJsDom;

/**
 * Converts a ReadableStream into a callback pattern.
 * @param stream The input ReadableStream.
 * @param onChunk A function that will be called on each new byte chunk in the stream.
 * @returns {Promise<void>} A promise that will be resolved when the stream closes.
 */
async function getBytes(stream, onChunk, responseTimeout) {
  const reader = stream.getReader();
  let result = {
    done: false,
    value: new Uint8Array(),
  };
  while (result && !result.done) {
    result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("getBytes timed out")),
          responseTimeout
        );
      }),
    ]);
    onChunk(result.value);
  }
}
/**
 * Parses arbitary byte chunks into EventSource line buffers.
 * Each line should be of the format "field: value" and ends with \r, \n, or \r\n.
 * @param onLine A function that will be called on each new EventSource line.
 * @returns A function that should be called for each incoming byte chunk.
 */
function getLines(onLine) {
  let buffer;
  let position; // current read position
  let fieldLength; // length of the `field` portion of the line
  let discardTrailingNewline = false;
  // return a function that can process each incoming byte chunk:
  return function onChunk(arr) {
    if (buffer === undefined) {
      buffer = arr;
      position = 0;
      fieldLength = -1;
    } else {
      // we're still parsing the old line. Append the new bytes into buffer:
      buffer = concat(buffer, arr);
    }
    const bufLength = buffer.length;
    let lineStart = 0; // index where the current line starts
    while (position < bufLength) {
      if (discardTrailingNewline) {
        if (buffer[position] === 10 /* ControlChars.NewLine */) {
          lineStart = ++position; // skip to next char
        }
        discardTrailingNewline = false;
      }
      // start looking forward till the end of line:
      let lineEnd = -1; // index of the \r or \n char
      for (; position < bufLength && lineEnd === -1; ++position) {
        switch (buffer[position]) {
          case 58 /* ControlChars.Colon */:
            if (fieldLength === -1) {
              // first colon in line
              fieldLength = position - lineStart;
            }
            break;
          // @ts-ignore:7029 \r case below should fallthrough to \n:
          case 13 /* ControlChars.CarriageReturn */:
            discardTrailingNewline = true;
          case 10 /* ControlChars.NewLine */:
            lineEnd = position;
            break;
        }
      }
      if (lineEnd === -1) {
        // We reached the end of the buffer but the line hasn't ended.
        // Wait for the next arr and then continue parsing:
        break;
      }
      // we've reached the line end, send it out:
      onLine(buffer.subarray(lineStart, lineEnd), fieldLength);
      lineStart = position; // we're now on the next line
      fieldLength = -1;
    }
    if (lineStart === bufLength) {
      buffer = undefined; // we've finished reading it
    } else if (lineStart !== 0) {
      // Create a new view into buffer beginning at lineStart so we don't
      // need to copy over the previous lines when we get the new arr:
      buffer = buffer.subarray(lineStart);
      position -= lineStart;
    }
  };
}
/**
 * Parses line buffers into EventSourceMessages.
 * @param onId A function that will be called on each `id` field.
 * @param onRetry A function that will be called on each `retry` field.
 * @param onMessage A function that will be called on each message.
 * @returns A function that should be called for each incoming line buffer.
 */
function getMessages(onMessage, onId, onRetry) {
  let message = newMessage();
  const decoder = new TextDecoder();
  // return a function that can process each incoming line buffer:
  return function onLine(line, fieldLength) {
    if (line.length === 0) {
      // empty line denotes end of message. Trigger the callback and start a new message:
      onMessage?.(message);
      message = newMessage();
    } else if (fieldLength > 0) {
      // exclude comments and lines with no values
      // line is of format "<field>:<value>" or "<field>: <value>"
      // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
      const field = decoder.decode(line.subarray(0, fieldLength));
      const valueOffset =
        fieldLength +
        (line[fieldLength + 1] === 32 /* ControlChars.Space */ ? 2 : 1);
      const value = decoder.decode(line.subarray(valueOffset));
      switch (field) {
        case "data":
          // if this message already has data, append the new value to the old.
          // otherwise, just set to the new value:
          message.data = message.data ? message.data + "\n" + value : value; // otherwise,
          break;
        case "event":
          message.event = value;
          break;
        case "id":
          onId?.((message.id = value));
          break;
        case "retry":
          const retry = parseInt(value, 10);
          if (!isNaN(retry)) {
            // per spec, ignore non-integers
            onRetry?.((message.retry = retry));
          }
          break;
      }
    }
  };
}
function concat(a, b) {
  const res = new Uint8Array(a.length + b.length);
  res.set(a);
  res.set(b, a.length);
  return res;
}
function newMessage() {
  // data, event, and id must be initialized to empty strings:
  // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
  // retry should be initialized to undefined so we return a consistent shape
  // to the js engine all the time: https://mathiasbynens.be/notes/shapes-ics#takeaways
  return {
    data: "",
    event: "",
    id: "",
    retry: undefined,
  };
}

const EventStreamContentType = "text/event-stream";
const DefaultRetryInterval = 1000;
const LastEventId = "last-event-id";
function fetchEventSource(
  input,
  {
    signal: inputSignal,
    headers: inputHeaders,
    onopen: inputOnOpen,
    onmessage,
    onclose,
    onerror,
    openWhenHidden,
    fetch: inputFetch,
    responseTimeout,
    ...rest
  }
) {
  return new Promise((resolve, reject) => {
    // make a copy of the input headers since we may modify it below:
    const headers = { ...inputHeaders };
    if (!headers.accept) {
      headers.accept = EventStreamContentType;
    }
    let curRequestController;
    function onVisibilityChange() {
      curRequestController.abort(); // close existing request on every visibility change
      if (!document.hidden) {
        create(); // page is now visible again, recreate request.
      }
    }
    if (typeof document !== "undefined" && !openWhenHidden) {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    let retryInterval = DefaultRetryInterval;
    let retryTimer;
    function dispose() {
      if (typeof document !== "undefined" && !openWhenHidden) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      clearTimeout(retryTimer);
      curRequestController.abort();
    }
    // if the incoming signal aborts, dispose resources and resolve:
    inputSignal?.addEventListener("abort", () => {
      dispose();
      resolve(); // don't waste time constructing/logging errors
    });
    const fetchFn = inputFetch ?? fetch;
    const onopen = inputOnOpen ?? defaultOnOpen;
    let isReconnect = false;
    async function create() {
      curRequestController = new AbortController();
      try {
        const response = await Promise.race([
          fetchFn(input, {
            ...rest,
            headers,
            signal: curRequestController.signal,
          }),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("fetch timed out")),
              responseTimeout
            );
          }),
        ]);
        if (response.status === 404) {
          onerror?.(new ReapError("Channel reaped"));
          dispose();
          resolve();
          return;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Invalid server response: ${response.status}`);
        }
        await onopen(response, isReconnect);
        // reset reconnect status
        if (isReconnect) {
          isReconnect = false;
        }
        await getBytes(
          response.body,
          getLines(
            getMessages(
              onmessage,
              (id) => {
                if (id) {
                  // store the id and send it back on the next retry:
                  headers[LastEventId] = id;
                } else {
                  // don't send the last-event-id header anymore:
                  delete headers[LastEventId];
                }
              },
              (retry) => {
                retryInterval = retry;
              }
            )
          ),
          responseTimeout
        );
        onclose?.();
        dispose();
        resolve();
      } catch (err) {
        if (!curRequestController.signal.aborted) {
          // if we haven't aborted the request ourselves:
          try {
            isReconnect = true;
            // check if we need to retry:
            const interval = onerror?.(err) ?? retryInterval;
            clearTimeout(retryTimer);
            curRequestController.abort();
            retryTimer = setTimeout(create, interval);
          } catch (innerErr) {
            // we should not retry anymore:
            dispose();
            reject(innerErr);
          }
        }
      }
    }
    create();
  });
}
function defaultOnOpen(response) {
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith(EventStreamContentType)) {
    throw new Error(
      `Expected content-type to be ${EventStreamContentType}, Actual: ${contentType}`
    );
  }
}

/**
 * Returns a hex string of given length.
 *
 * Poached from StackOverflow.
 *
 * @param len Length of hex string to return.
 */
function hexString(len) {
  const maxlen = 8;
  const min = Math.pow(16, Math.min(len, maxlen) - 1);
  const max = Math.pow(16, Math.min(len, maxlen)) - 1;
  const n = Math.floor(Math.random() * (max - min + 1)) + min;
  let r = n.toString(16);
  while (r.length < len) {
    r = r + hexString(len - maxlen);
  }
  return r;
}
class EventEmitter {
  listeners = {};
  on(event, callback) {
    if (!this.listeners.hasOwnProperty(event)) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return this;
  }
  emit(event, ...data) {
    if (!this.listeners.hasOwnProperty(event)) {
      return null;
    }
    for (let i = 0; i < this.listeners[event].length; i++) {
      const callback = this.listeners[event][i];
      callback.call(this, ...data);
    }
  }
}

/**
 * A class for interacting with an urbit ship, given its URL and code
 */
class Urbit {
  url;
  code;
  desk;
  /**
   * Event emitter for debugging, see events.ts for full list of events
   */
  emitter = new EventEmitter();
  /**
   * UID will be used for the channel: The current unix time plus a random hex string
   */
  uid = `${Math.floor(Date.now() / 1000)}-${hexString(6)}`;
  /**
   * lastEventId is an auto-updated index of which events have been *sent* over this channel.
   * lastHeardEventId is the latest event we have heard back about.
   * lastAcknowledgedEventId is the latest event we have sent an ack for.
   */
  lastEventId = 0;
  lastHeardEventId = -1;
  lastAcknowledgedEventId = -1;
  /**
   * SSE Client is null for now; we don't want to start polling until it the channel exists
   */
  sseClientInitialized = false;
  /**
   * Cookie gets set when we log in.
   */
  cookie;
  /**
   * A registry of requestId to successFunc/failureFunc
   *
   * These functions are registered during a +poke and are executed
   * in the onServerEvent()/onServerError() callbacks. Only one of
   * the functions will be called, and the outstanding poke will be
   * removed after calling the success or failure function.
   */
  outstandingPokes = new Map();
  /**
   * A registry of requestId to subscription functions.
   *
   * These functions are registered during a +subscribe and are
   * executed in the onServerEvent()/onServerError() callbacks. The
   * event function will be called whenever a new piece of data on this
   * subscription is available, which may be 0, 1, or many times. The
   * disconnect function may be called exactly once.
   */
  outstandingSubscriptions = new Map();
  /**
   * Our abort controller, used to close the connection
   */
  abort = new AbortController();
  /**
   * Identity of the ship we're connected to
   */
  ship;
  /**
   * Our identity, with which we are authenticated into the ship
   */
  our;
  /**
   * If verbose, logs output eagerly.
   */
  verbose;
  /**
   * number of consecutive errors in connecting to the eventsource
   */
  errorCount = 0;
  onError = null;
  onRetry = null;
  onOpen = null;
  onReconnect = null;
  /** This is basic interpolation to get the channel URL of an instantiated Urbit connection. */
  get channelUrl() {
    return `${this.url}/~/channel/${this.uid}`;
  }
  get fetchOptions() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (!isBrowser_1) {
      headers.Cookie = this.cookie;
    }
    return {
      credentials: "include",
      accept: "*",
      headers,
      signal: this.abort.signal,
    };
  }
  /**
   * Constructs a new Urbit connection.
   *
   * @param url  The URL (with protocol and port) of the ship to be accessed. If
   * the airlock is running in a webpage served by the ship, this should just
   * be the empty string.
   * @param code The access code for the ship at that address
   */
  constructor(url, code, desk) {
    this.url = url;
    this.code = code;
    this.desk = desk;
    if (isBrowser_1) {
      window.addEventListener("beforeunload", this.delete);
    }
    return this;
  }
  /**
   * All-in-one hook-me-up.
   *
   * Given a ship, url, and code, this returns an airlock connection
   * that is ready to go. It `|hi`s itself to create the channel,
   * then opens the channel via EventSource.
   *
   */
  //TODO  rename this to connect() and only do constructor & event source setup.
  //      that way it can be used with the assumption that you're already
  //      authenticated.
  static async authenticate({ ship, url, code, verbose = false }) {
    const airlock = new Urbit(
      url.startsWith("http") ? url : `http://${url}`,
      code
    );
    airlock.verbose = verbose;
    airlock.ship = ship;
    await airlock.connect();
    await airlock.poke({
      app: "hood",
      mark: "helm-hi",
      json: "opening airlock",
    });
    await airlock.eventSource();
    return airlock;
  }
  emit(event, data) {
    if (this.verbose) {
      this.emitter.emit(event, data);
    }
  }
  on(event, callback) {
    this.emitter.on(event, callback);
    this.verbose && console.log(event, "listening active");
    if (event === "init") {
      this.emitter.emit(event, {
        uid: this.uid,
        subscriptions: [...this.outstandingSubscriptions.entries()].map(
          ([k, v]) => ({ id: k, app: v.app, path: v.path })
        ),
      });
    }
  }
  /**
   * Gets the name of the ship accessible at this.url and stores it to this.ship
   *
   */
  async getShipName() {
    if (this.ship) {
      return Promise.resolve();
    }
    const nameResp = await fetch(`${this.url}/~/host`, {
      method: "get",
      credentials: "include",
    });
    const name = await nameResp.text();
    this.ship = name.substring(1);
  }
  /**
   * Gets the name of the ship accessible at this.url and stores it to this.ship
   *
   */
  async getOurName() {
    if (this.our) {
      return Promise.resolve();
    }
    const nameResp = await fetch(`${this.url}/~/name`, {
      method: "get",
      credentials: "include",
    });
    const name = await nameResp.text();
    this.our = name.substring(1);
  }
  /**
   * Connects to the Urbit ship. Nothing can be done until this is called.
   * That's why we roll it into this.authenticate
   * TODO  as of urbit/urbit#6561, this is no longer true, and we are able
   *       to interact with the ship using a guest identity.
   */
  //TODO  rename to authenticate() and call connect() at the end
  async connect() {
    if (this.verbose) {
      console.log(
        `password=${this.code} `,
        isBrowser_1
          ? "Connecting in browser context at " + `${this.url}/~/login`
          : "Connecting from node context"
      );
    }
    return fetch(`${this.url}/~/login`, {
      method: "post",
      body: `password=${this.code}`,
      credentials: "include",
    }).then(async (response) => {
      if (this.verbose) {
        console.log("Received authentication response", response);
      }
      // if (response.status >= 200 && response.status < 300) {
      //   throw new Error('Login failed with status ' + response.status);
      // }
      const cookie = response.headers.get("set-cookie");
      if (!this.ship && cookie) {
        this.ship = new RegExp(/urbauth-~([\w-]+)/).exec(cookie)[1];
      }
      if (!isBrowser_1) {
        this.cookie = cookie;
      }
      this.getShipName();
      this.getOurName();
    });
  }
  /**
   * Initializes the SSE pipe for the appropriate channel.
   */
  async eventSource() {
    if (this.sseClientInitialized) {
      return Promise.resolve();
    }
    if (this.lastEventId === 0) {
      this.emit("status-update", { status: "opening" });
      // Can't receive events until the channel is open,
      // so poke and open then
      await this.poke({
        app: "hood",
        mark: "helm-hi",
        json: "Opening API channel",
      });
      return;
    }
    this.sseClientInitialized = true;
    return new Promise((resolve, reject) => {
      fetchEventSource(this.channelUrl, {
        ...this.fetchOptions,
        openWhenHidden: true,
        responseTimeout: 25000,
        onopen: async (response, isReconnect) => {
          if (this.verbose) {
            console.log("Opened eventsource", response);
          }
          if (isReconnect) {
            this.onReconnect && this.onReconnect();
          }
          if (response.ok) {
            this.errorCount = 0;
            this.onOpen && this.onOpen();
            this.emit("status-update", {
              status: isReconnect ? "reconnected" : "active",
            });
            resolve();
            return; // everything's good
          } else {
            const err = new Error("failed to open eventsource");
            reject(err);
          }
        },
        onmessage: (event) => {
          if (this.verbose) {
            console.log("Received SSE: ", event);
          }
          if (!event.id) return;
          const eventId = parseInt(event.id, 10);
          this.emit("fact", {
            id: eventId,
            data: event.data,
            time: Date.now(),
          });
          if (eventId <= this.lastHeardEventId) {
            if (this.verbose) {
              console.log("dropping old or out-of-order event", {
                eventId,
                lastHeard: this.lastHeardEventId,
              });
            }
            return;
          }
          this.lastHeardEventId = eventId;
          this.emit("id-update", { lastHeard: this.lastHeardEventId });
          if (eventId - this.lastAcknowledgedEventId > 20) {
            this.ack(eventId);
          }
          if (event.data && JSON.parse(event.data)) {
            const data = JSON.parse(event.data);
            if (
              data.response === "poke" &&
              this.outstandingPokes.has(data.id)
            ) {
              const funcs = this.outstandingPokes.get(data.id);
              if (data.hasOwnProperty("ok")) {
                funcs.onSuccess();
              } else if (data.hasOwnProperty("err")) {
                console.error(data.err);
                funcs.onError(data.err);
              } else {
                console.error("Invalid poke response", data);
              }
              this.outstandingPokes.delete(data.id);
            } else if (
              data.response === "subscribe" &&
              this.outstandingSubscriptions.has(data.id)
            ) {
              const funcs = this.outstandingSubscriptions.get(data.id);
              if (data.hasOwnProperty("err")) {
                console.error(data.err);
                funcs.err(data.err, data.id);
                this.outstandingSubscriptions.delete(data.id);
              }
            } else if (
              data.response === "diff" &&
              this.outstandingSubscriptions.has(data.id)
            ) {
              const funcs = this.outstandingSubscriptions.get(data.id);
              try {
                funcs.event(data.json, data.mark ?? "json", data.id);
              } catch (e) {
                console.error("Failed to call subscription event callback", e);
              }
            } else if (
              data.response === "quit" &&
              this.outstandingSubscriptions.has(data.id)
            ) {
              const funcs = this.outstandingSubscriptions.get(data.id);
              funcs.quit(data);
              this.outstandingSubscriptions.delete(data.id);
              this.emit("subscription", {
                id: data.id,
                status: "close",
              });
            } else if (this.verbose) {
              console.log([...this.outstandingSubscriptions.keys()]);
              console.log("Unrecognized response", data);
            }
          }
        },
        onerror: (error) => {
          this.errorCount++;
          this.emit("error", { time: Date.now(), msg: JSON.stringify(error) });
          if (error instanceof ReapError) {
            this.seamlessReset();
            return;
          }
          if (!(error instanceof FatalError)) {
            this.emit("status-update", { status: "reconnecting" });
            this.onRetry && this.onRetry();
            return Math.min(5000, Math.pow(2, this.errorCount - 1) * 750);
          }
          this.emit("status-update", { status: "errored" });
          this.onError && this.onError(error);
          throw error;
        },
        onclose: () => {
          console.log("e");
          throw new Error("Ship unexpectedly closed the connection");
        },
      });
    });
  }
  /**
   * Reset airlock, abandoning current subscriptions and wiping state
   *
   */
  reset() {
    if (this.verbose) {
      console.log("resetting");
    }
    this.delete();
    this.abort.abort();
    this.abort = new AbortController();
    this.uid = `${Math.floor(Date.now() / 1000)}-${hexString(6)}`;
    this.emit("reset", { uid: this.uid });
    this.lastEventId = 0;
    this.lastHeardEventId = -1;
    this.lastAcknowledgedEventId = -1;
    this.outstandingSubscriptions = new Map();
    this.outstandingPokes = new Map();
    this.sseClientInitialized = false;
  }
  seamlessReset() {
    // called if a channel was reaped by %eyre before we reconnected
    // so we have to make a new channel.
    this.uid = `${Math.floor(Date.now() / 1000)}-${hexString(6)}`;
    this.emit("seamless-reset", { uid: this.uid });
    this.emit("status-update", { status: "initial" });
    this.sseClientInitialized = false;
    this.lastEventId = 0;
    this.lastHeardEventId = -1;
    this.lastAcknowledgedEventId = -1;
    const oldSubs = [...this.outstandingSubscriptions.entries()];
    this.outstandingSubscriptions = new Map();
    oldSubs.forEach(([id, sub]) => {
      sub.quit({
        id,
        response: "quit",
      });
      this.emit("subscription", {
        id,
        status: "close",
      });
    });
    this.outstandingPokes.forEach((poke, id) => {
      poke.onError("Channel was reaped");
    });
    this.outstandingPokes = new Map();
  }
  /**
   * Autoincrements the next event ID for the appropriate channel.
   */
  getEventId() {
    this.lastEventId += 1;
    this.emit("id-update", { current: this.lastEventId });
    return this.lastEventId;
  }
  /**
   * Acknowledges an event.
   *
   * @param eventId The event to acknowledge.
   */
  async ack(eventId) {
    this.lastAcknowledgedEventId = eventId;
    this.emit("id-update", { lastAcknowledged: eventId });
    const message = {
      action: "ack",
      "event-id": eventId,
    };
    await this.sendJSONtoChannel(message);
    return eventId;
  }
  async sendJSONtoChannel(...json) {
    const response = await fetch(this.channelUrl, {
      ...this.fetchOptions,
      method: "PUT",
      body: JSON.stringify(json),
    });
    if (!response.ok) {
      throw new Error("Failed to PUT channel");
    }
    if (!this.sseClientInitialized) {
      if (this.verbose) {
        console.log("initializing event source");
      }
      await this.eventSource();
    }
  }
  /**
   * Creates a subscription, waits for a fact and then unsubscribes
   *
   * @param app Name of gall agent to subscribe to
   * @param path Path to subscribe to
   * @param timeout Optional timeout before ending subscription
   *
   * @returns The first fact on the subcription
   */
  async subscribeOnce(app, path, timeout) {
    return new Promise(async (resolve, reject) => {
      let done = false;
      let id = null;
      const quit = () => {
        if (!done) {
          reject("quit");
        }
      };
      const event = (e, mark, id) => {
        if (!done) {
          resolve(e);
          this.unsubscribe(id);
        }
      };
      const request = { app, path, event, err: reject, quit };
      id = await this.subscribe(request);
      if (timeout) {
        setTimeout(() => {
          if (!done) {
            done = true;
            reject("timeout");
            this.unsubscribe(id);
          }
        }, timeout);
      }
    });
  }
  /**
   * Pokes a ship with data.
   *
   * @param app The app to poke
   * @param mark The mark of the data being sent
   * @param json The data to send
   */
  async poke(params) {
    const { app, mark, json, ship, onSuccess, onError } = {
      onSuccess: () => {},
      onError: () => {},
      ship: this.ship,
      ...params,
    };
    if (this.lastEventId === 0) {
      this.emit("status-update", { status: "opening" });
    }
    const message = {
      id: this.getEventId(),
      action: "poke",
      ship,
      app,
      mark,
      json,
    };
    this.outstandingPokes.set(message.id, {
      onSuccess: () => {
        onSuccess();
      },
      onError: (err) => {
        onError(err);
      },
    });
    await this.sendJSONtoChannel(message);
    return message.id;
  }
  /**
   * Subscribes to a path on an app on a ship.
   *
   *
   * @param app The app to subsribe to
   * @param path The path to which to subscribe
   * @param handlers Handlers to deal with various events of the subscription
   */
  async subscribe(params) {
    const { app, path, ship, err, event, quit } = {
      err: () => {},
      event: () => {},
      quit: () => {},
      ship: this.ship,
      ...params,
    };
    if (this.lastEventId === 0) {
      this.emit("status-update", { status: "opening" });
    }
    const message = {
      id: this.getEventId(),
      action: "subscribe",
      ship,
      app,
      path,
    };
    this.outstandingSubscriptions.set(message.id, {
      app,
      path,
      err,
      event,
      quit,
    });
    this.emit("subscription", {
      id: message.id,
      app,
      path,
      status: "open",
    });
    await this.sendJSONtoChannel(message);
    return message.id;
  }
  /**
   * Unsubscribes to a given subscription.
   *
   * @param subscription
   */
  async unsubscribe(subscription) {
    return this.sendJSONtoChannel({
      id: this.getEventId(),
      action: "unsubscribe",
      subscription,
    }).then(() => {
      this.emit("subscription", {
        id: subscription,
        status: "close",
      });
      this.outstandingSubscriptions.delete(subscription);
    });
  }
  /**
   * Deletes the connection to a channel.
   */
  async delete() {
    const body = JSON.stringify([
      {
        id: this.getEventId(),
        action: "delete",
      },
    ]);
    if (isBrowser_1) {
      navigator.sendBeacon(this.channelUrl, body);
    } else {
      const response = await fetch(this.channelUrl, {
        ...this.fetchOptions,
        method: "POST",
        body: body,
      });
      if (!response.ok) {
        throw new Error("Failed to DELETE channel in node context");
      }
    }
  }
  /**
   * Scry into an gall agent at a path
   *
   * @typeParam T - Type of the scry result
   *
   * @remarks
   *
   * Equivalent to
   * ```hoon
   * .^(T %gx /(scot %p our)/[app]/(scot %da now)/[path]/json)
   * ```
   * The returned cage must have a conversion to JSON for the scry to succeed
   *
   * @param params The scry request
   * @returns The scry result
   */
  async scry(params) {
    const { app, path } = params;
    const response = await fetch(
      `${this.url}/~/scry/${app}${path}.json`,
      this.fetchOptions
    );
    if (!response.ok) {
      return Promise.reject(response);
    }
    return await response.json();
  }
  /**
   * Run a thread
   *
   *
   * @param inputMark   The mark of the data being sent
   * @param outputMark  The mark of the data being returned
   * @param threadName  The thread to run
   * @param body        The data to send to the thread
   * @returns  The return value of the thread
   */
  async thread(params) {
    const {
      inputMark,
      outputMark,
      threadName,
      body,
      desk = this.desk,
    } = params;
    if (!desk) {
      throw new Error("Must supply desk to run thread from");
    }
    const res = await fetch(
      `${this.url}/spider/${desk}/${inputMark}/${threadName}/${outputMark}.json`,
      {
        ...this.fetchOptions,
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return res.json();
  }
  /**
   * Utility function to connect to a ship that has its *.arvo.network domain configured.
   *
   * @param name Name of the ship e.g. zod
   * @param code Code to log in
   */
  static async onArvoNetwork(ship, code) {
    const url = `https://${ship}.arvo.network`;
    return await Urbit.authenticate({ ship, url, code });
  }
}

exports.FatalError = FatalError;
exports.ReapError = ReapError;
exports.ResumableError = ResumableError;
exports.Urbit = Urbit;
exports["default"] = Urbit;
//# sourceMappingURL=index.cjs.map
