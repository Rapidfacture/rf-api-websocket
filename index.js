const WebSocketServer = require('ws').Server;
const log = require('rf-log');
const util = require('util');


/**
* # rf-api-websocket
*
* rf-api implementation for RPC over websockets using JSON messages with optional ACL.
*
* NOTE: Alpha!
*
*/
class WebsocketServer {
   /**
   * ##  ws server
   * * Uses express server instance
   * * Websocket communication service
   * * Allows safe RPC
   * * Uses JSON messages
   */
   constructor (httpServer) {
      // All active connections for broadcast
      this.allWS = [];
      this.handlers = {}; // func name => handler(msg, responseCallback(err, ))
      // Initialize server
      this.server = new WebSocketServer({
         server: httpServer
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
     * ## ws methods
     */


   /**
     * ### addHandler
     * Add a simple callback handler.
     * Errors can be signalled via exceptions
     * Any previous handler with the same func name will be replaced.
     * ```js
     * services.addHandler (funcName, callback, acl = {})
     * ```
     * * `funcName` The name of the handler. In order for the handler to be called, this needs to be used
     * in the func attribute of the received websocket message.
     * * `callback` The handler function(msg, responseCallback(msg))
     * * `acl` Optional ACD configuraton
     */
   addHandler (funcName, callback, acl = {}) {
      this.handlers[funcName] = new CallbackHandler(funcName, callback, acl, log);
   }

   /**
     * ### addPromiseHandler
     * Add a promise callback handler that either resolves to null (no response) or to
     * response data and signals exceptions via rejection (logged, no response.
     * Any previous handler with the same func name will be replaced.
     * ```js
     * services.addPromiseHandler (funcName, genPromise, acl = {})
     * ```
     * * `funcName` The name of the handler. In order for the handler to be called, this needs to be used
     * in the func attribute of the received websocket message.
     * * `callback` The handler function(msg, responseCallback(msg))
     * * `acl` Optional ACD configuraton
     */
   addPromiseHandler (funcName, genPromise, acl = {}) {
      this.handlers[funcName] = new PromiseHandler(funcName, genPromise, acl, log);
   }

   /**
     * ### sendObj
     * ```js
     * services.sendObj (ws, obj)
     * ```
     * TODO: integrate callbackID
     * maybe one raw send method, and one preconfigured (default to use)
     */
   sendObj (ws, obj) {
      try {
         return ws.send(JSON.stringify(obj));
      } catch (err) {
         this.log.error(`Failed to send websocket message: ${err}`);
      }
   }


   /**
     * ### broadcast
     * Send the given object to ALL the currently connected websockets
     * NOTE: This sends the object as-is.
     * ```js
     * services.broadcast (obj)
     * ```
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
   const API = require('rf-load').require('rf-api').API;
   const http = require('rf-load').require('http');
   const instance = new WebsocketServer(http.server);

   API.onWSMessage = function (...args) { instance.addHandler(...args); };
   API.onWSMessagePromise = function (...args) { instance.addPromiseHandler(...args); };

   startNextModule();
};

// Export class for the unlikely case of non-rf-api users. But who knows?
module.exports.WebsocketServer = WebsocketServer;

/**
*
* ## PeerDependencies
* * `rf-log`
* * `rf-load`
* * `rf-api`
* * rapidfacture `http` file
*
* ## Development
*
* Install the dev tools with
* > npm install
*
* Then you can runs some test cases and eslint with:
* > npm test
*
* Generate Docs:
* > npm run-script doc
*
* ## To Do
* * get the everything running
*
* ## Legal Issues
* * License: MIT
* * Author: Rapidfacture GmbH
*
*/
