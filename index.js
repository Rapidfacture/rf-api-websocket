const WebSocketServer = require('ws').Server;
const log = require('rf-log');
const util = require('util');
const _ = require("lodash");

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
      log.info("Initializing websocket server")
      // Initialize server
      this.server = new WebSocketServer({
         server: httpServer
      });
      this.server.on('connection', (ws) => this.onConnection(ws));
      this.allWS = []; // All active connections for broadcast
      this.handlers = {}; // func name => handler(msg, responseCallback(err, ))
   }

   onConnection (ws) {
      log.info(`New websocket connected`);
      // Add to broadcast list
      this.allWS.push(ws);
      // console.log(ws.upgradeReq.url);
      ws.on('message', (data, flags) => this.onMessage(ws, data, flags));
      ws.on('close', () => this.onClose(ws));
   }

   onClose (ws) {
      log.info('Websocket connection closed');
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
         return log.error(`Failed to parse websocket message JSON: ${ex}`);
      }
      log.info('websocket message received');
      // Check msg validity
      if (!msg.func) {
         return log.error(`Received websocket message without specified func: ${util.inspect(msg)}`);
      }
      if (_.isNil(msg.data)) { // null or undefined. Empty data is OK as long as its present
         return log.error(`Received websocket message without any data: ${util.inspect(msg)}`);
      }
      data = msg.data;
      // Prepare "prototype" (to be sent back), i.e. keep anything besides 'data'
      const protoObj = msg;
      delete protoObj.data;
      // Try to find correct function
      const func = msg.func;
      const handler = this.handlers[func];
      if (!handler) {
         return log.error(`Can't find any handler for function ${func}`);
      }
      // Call handler with custom "send" callback
      return handler.handle(data, newData => {
         // NOTE: Multiple calls will send multiple msgs
         const wsObj = protoObj;
         wsObj.data = newData;
         return this.sendObj(ws, wsObj);
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
      this.handlers[funcName] = new CallbackHandler(funcName, callback, acl);
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
      this.handlers[funcName] = new PromiseHandler(funcName, genPromise, acl);
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
         log.error(`Failed to send websocket message: ${err}`);
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
   constructor (name, callback, acl) {
      this.name = name;
      this.callback = callback;
      this.acl = acl;
   }

   handle (data, send) {
      try {
         this.callback(data, send);
      } catch (err) {
         log.error(`Exception in websocket handler ${this.name}: ${err}`);
      }
   }
}

// Represents a handler function that takes a promise
// that either resolves to null (no response) or to a
class PromiseHandler {
   constructor (name, genPromise, acl) {
      this.name = name;
      this.genPromise = genPromise;
      this.acl = acl;
   }

   handle (data, send) {
      this.callback(data).then(result => {
         if (result !== null) {
            if (!result.err) {
               result.err = null;
            }
            send(result);
         }
      }).catch(err => {
         log.error(`Websocket handler ${this.name} rejected: ${err}`);
         send({err: err});
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
* ## Getting started
*
* When the module is started, the websocket server and handler is automatically
* registered against the HTTP server. You dont need to start the server manually!
*
* Websocket messages have the form:
* {func: "<function>", data: {...}, token: "<optional JWT token>"}
* Any other attributes are copied to the response
*
* Register a handler like this:
* ```js
* API.onWSMessage("myfunc", (msg, respondWS, userInfo) => {
*     // userInfo contains the object extracted from the JWT (or {} if no token was supplied)
*     // If the user does not have the required permissions or the message is malformed,
*     // this function is not called but instead an error msg is sent!
*     if(!userInfo.isAdmin) {
*       return false;
*     }
*     // Handle message (msg is .data of the original message)
*     console.log(msg.foobar)
*     // Then send response. Convention is to have an err attribute
*     respondWS({err: null, info: "It works"});
*     // NOTE: You can call respondWS multiple times if required!
* }, {}) // Empty ACL => no auth required
* ```
*
* See the `rf-acl` package for documentation about the ACL syntax
*
* If you are using Promises, use this syntax
* ```js
* API.onWSMessagePromise("myfunc", (msg, respondWS, userInfo) => {
*   return new Promise((resolve, reject) => {
*     if(!userInfo.isAdmin) {
*       return reject("nope"); // Will send {err: "nope"}
*     }
*     return resolve({"foo": "bar"}); // will send {err: null, "foo": "bar"}
*   });
* }, {}) // Empty ACL => no auth required
* ```
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
