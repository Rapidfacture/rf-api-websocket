
const WebSocketServer = require('ws').Server;
const log = require('rf-log');
const util = require('util');

// peer dependency: rf-load, http server and API
const http = require('rf-load').require('http');
const API = require('rf-load').require('rf-api').API;



class WebsocketServer {
   /* ---------------- ws server and events ---------------- */
   constructor () {
      // All active connections for broadcast
      this.allWS = [];
      this.handlers = {}; // func name => handler(msg, responseCallback(err, ))
      // Initialize server
      this.server = new WebSocketServer({
         server: http.server
      });
      this.server.on('connection', this.onConnection);
   }

   onConnection (ws) {
      log.info(`websocket connection open: ${ws.upgradeReq.url}`);
      // Add to broadcast list
      this.allWS.push(ws);
      // console.log(ws.upgradeReq.url);
      ws.on('message', (data, flags) => this.onMessage(ws, data, flags));
      ws.on('close', () => this.onClose(ws));
   }

   onClose (ws) {
      log.info('websocket connection close');
      // Remove from allWS list
      let idx = this.allWS.indexOf(ws);
      if (idx > -1) {
         this.allWS.splice(idx, 1);
      }
   }

   onMessage (ws, data, flags) {
      let msg = {};
      try {
         msg = JSON.parse(data);
      } catch (ex) {
         return this.log.error(`Failed to parse websocket message JSON: ${ex}`);
      }
      this.log.info('websocket message received');
      // Check msg validity
      if (!msg.func) {
         return this.log.error(`Received websocket message without specified func: ${util.inspect(msg)}`);
      }
      if (!msg.data) {
         return this.log.error(`Received websocket message without any data: ${util.inspect(msg)}`);
      }
      data = msg.data;
      // Prepare "prototype" (to be sent back), i.e. keep anything besides 'data'
      const protoObj = msg;
      delete protoObj.data;
      // Try to find correct function
      const func = msg.func;
      const handler = this.handlers[func];
      if (!handler) {
         return this.log.error(`Can't find any handler for function ${func}`);
      }
      this.log.info(`Received correct websocket message with func ${func}`);
      // Call handler with custom "send" callback
      return handler.handle(data, newData => {
         // NOTE: Multiple calls will
         const wsObj = protoObj;
         wsObj.data = newData;
         return this.sendObj(wsObj);
      });
   }

   /* ---------------- ws methods ---------------- */

   /**
     * Add a simple callback handler.
     * Errors can be signalled via exceptions
     * Any previous handler with the same func name will be replaced.
     * @param {*} funcName The name of the handler. In order for the handler to be called, this needs to be used
     * in the func attribute of the received websocket message.
     * @param {*} handler The handler function(msg, responseCallback(msg))
     * @param {*} acl Optional ACD configuraton
     */
   addHandler (funcName, callback, acl = {}) {
      this.handlers[funcName] = new CallbackHandler(funcName, callback, acl, log);
   }

   /**
     * Add a promise callback handler that either resolves to null (no response) or to
     * response data and signals exceptions via rejection (logged, no response.
     * Any previous handler with the same func name will be replaced.
     * @param {*} funcName The name of the handler. In order for the handler to be called, this needs to be used
     * in the func attribute of the websocket message.
     * @param {*} handler The handler function(msg) that returns a Promise as described above.
     * @param {*} acl Optional ACD configuraton
     */
   addPromiseHandler (funcName, genPromise, acl = {}) {
      this.handlers[funcName] = new PromiseHandler(funcName, genPromise, acl, log);
   }

   sendObj (ws, obj) {
      try {
         return ws.send(JSON.stringify(obj));
      } catch (err) {
         this.log.error(`Failed to send websocket message: ${err}`);
      }
   }

   /**
     * Send the given object to ALL the currently connected websockets
     * NOTE: This sends the object as-is.
     * @param {*} obj
     */
   broadcast (obj) {
      for (let ws of this.allWS) {
         this.sendObj(ws, obj);
      }
   }
}


/* ---------------- helper functions ---------------- */

// Represents a handler function that takes (data, sendCallback),
// signals errors via exceptions and can call the send callback multiple times
// if required.
class CallbackHandler {
   constructor (name, callback, acl, log) {
      this.name = name;
      this.callback = callback;
      this.acl = acl;
      this.log = log;
   }

   Handle (data, send) {
      try {
         this.callback(data, send);
      } catch (err) {
         this.log.error(`Exception in websocket handler ${this.name}: ${err}`);
      }
   }
}

// Represents a handler function that takes a promise
// that either resolves to null (no response) or to a
class PromiseHandler {
   constructor (name, genPromise, acl, log) {
      this.name = name;
      this.genPromise = genPromise;
      this.acl = acl;
      this.log = log;
   }

   Handle (data, send) {
      this.callback(data).then(result => {
         if (result !== null) {
            send(result);
         }
      }).catch(err => {
         this.log.error(`Websocket handler ${this.name} rejected: ${err}`);
      });
   }
}


// integrate into `rf-api`
// TODO: is this the correct way? the websockets will be in "Services"?
module.exports.start = function (options, startNextModule) {
   API.Services.registerFunction(WebsocketServer);
   startNextModule();
};
