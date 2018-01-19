const WebSocketServer = require('ws').Server;
const log = require('rf-log');
const util = require('util');
const _ = require('lodash');

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
   *
   * checkACL(token, acl) is a function
   *   that returns a Promise that resolves with a custom attributes object
   *   or rejects if this token is not valid for the given ACL.
   * Usually, checkACL from the rf-acl project is used
   */
   constructor (httpServer, checkACL) {
      log.info('Initializing websocket server');
      // Initialize server
      this.server = new WebSocketServer({
         server: httpServer
      });
      this.server.on('connection', (ws) => this.onConnection(ws));
      this.allWS = []; // All active connections for broadcast
      this.handlers = {}; // func name => handler(msg, responseCallback(err, ))
      this.checkACL = checkACL;
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

   _sendErrorMessage (ws, msg, err, errsrc) {
      // Modify msg directly because there is no way multiple responses could be sent
      delete msg['data'];
      msg.err = `ACL error: ${err}`;
      msg.errsrc = 'auth-fail';
      this.sendObj(ws, msg);
   }

   onMessage (ws, data, flags) {
      let msg = {};
      try {
         msg = JSON.parse(data);
      } catch (ex) {
         return log.error(`Failed to parse websocket message JSON: ${ex}`);
      }
      // Check msg validity
      if (!msg.func) {
         this._sendErrorMessage(ws, msg, 'format',
            `msg.func is null or undefined. Please specify the function to use`);
         return log.error(`Received websocket message without specified func: ${util.inspect(msg)}`);
      }
      if (_.isNil(msg.data)) { // null or undefined. Empty data is OK as long as its present
         this._sendErrorMessage(ws, msg, 'format',
            `msg.data is null or undefined. Use empty data object if there is no data to send`);
         return log.error(`Received websocket message without any data: ${util.inspect(msg)}`);
      }
      // Try to find correct function
      const func = msg.func;
      const handler = this.handlers[func];
      if (!handler) {
         const msg = `No handler found for function '${func}'`;
         log.error(msg);
         return this._sendErrorMessage(ws, msg, 'no-such-handler', msg);
      }
      // Try to parse ACL
      const token = msg.token;
      this.checkACL(token).then(customAttributes => { // ACL check passed
         // Call handler with custom "send" callback
         handler.handle(new WebsocketRequest(msg, customAttributes, response =>
            this.sendObj(ws, response)
         ));
      }).catch(err => { // Either token parsing failed or the user is not permitted to access the ACL thing
         return this._sendErrorMessage(ws, msg, 'auth-fail', `ACL error: ${err}`);
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
     * * `callback` The handler function()
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
     * * `callback` The handler function(req) which returns a Promise
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

   handle (req) {
      try {
         log.info(this.name);
         // Use the SAME object for request AND response to avoid code dupes
         this.callback(req, req);
      } catch (err) {
         log.error(`Exception in websocket handler '${this.name}': ${err}`);
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

   handle (req) {
      this.callback(req, req).then(result => {
         if (result !== null) {
            req.send(null, result);
         }
      }).catch(err => {
         log.error(`Websocket handler ${this.name} rejected: ${err}`);
         req.send(err, {});
      });
   }
}


/**
 * Represents a websocket request object that contains
 * information on the request message and provides means to respond.
 *
 * NOTE: The SAME OBJECT is used as request AND response object.
 * The same object is passed to the handler TWICE!
 *
 * This object is constructed internally and should not be constructed
 * by the user.
 *
 * ```js
 * function handler(req, res) {
 *    let req = ... // any websocket request
 *    req.msg // The original request, req.msg.data == req.data
 *    req.data // The request data
 *    req.[...] // Custom attributes as defined by the ACL layer
 *    res.send(...) // See docs for WebsocketRequest.send()
 * }
 * ```
 */
class WebsocketRequest {
   constructor (msg, customAttributes, sendResponse) {
      this.msg = msg;
      this.data = msg.data || {};
      this.sendResponse = sendResponse;
      // Add custom attributes to this directl
      _.extend(this, customAttributes);
   }

   /**
    * Send a response to the requester.
    * ```js
    * req.send(null, {foo: "bar"}) // Send data, no error
    * req.send("describe error here", {foo: "bar"}) // Send error + data
    * req.send("describe error here") // Send error without data
    * req.send("Not permitted to do this", {}, 'auth-failed') // Send with custom errsrc. Default is 'application'
    * ```
    * Multiple calls will send multiple messages
    */
   send (err, data = {}, errsrc = 'application') {
      // NOTE: Multiple calls will send multiple msgs
      const responseObj = _.cloneDeep(this.msg);
      responseObj.data = data || {};
      responseObj.err = err || null;
      responseObj.errsrc = _.isNil(err) ? undefined : errsrc;
      this.sendResponse(responseObj);
   }
}


// integrate into `rf-api`
// TODO: is this the correct way? the websockets will be in "Services"?
module.exports.start = function (options, startNextModule, services) {
   const API = require('rf-load').require('rf-api').API;
   // TODO Why twice Services?
   const Services = API.Services.Services;
   const http = require('rf-load').require('http');
   const instance = new WebsocketServer(http.server, Services.checkACL);

   API.onWSMessage = function (...args) { instance.addHandler(...args); };
   API.onWSMessagePromise = function (...args) { instance.addPromiseHandler(...args); };

   startNextModule();
};

// Export class for the unlikely case of non-rf-api users. But who knows?
module.exports.WebsocketServer = WebsocketServer;
module.exports.WebsocketRequest = WebsocketRequest;

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
* API.onWSMessage("myfunc", (req) => {
*     // NOTE: Custom attributes are defined by the ACL layer.
*     // This is just a basic example on how to use it
*     if(req.session.isExpired) {
*       return false;
*     }
*     // Handle message (msg is .data of the original message)
*     console.log(req.data.foobar)
*     // Then send response. Convention is to have an err attribute
*     req.send(null, {info: "It works"});
*     // On error use this (data object is optional)
*     req.send("it didnt work", {description: `${err}`});
*     // NOTE: You can call req.send multiple times if required!
* }, {}) // Empty ACL => no auth required
* ```
*
* See the `rf-acl` package for documentation about the ACL syntax
*
* If you are using Promises, use this syntax
* ```js
* API.onWSMessagePromise("myfunc", (req) => {
*   return new Promise((resolve, reject) => {
*     // NOTE: Custom attributes are defined by the ACL layer.
*     // This is just a basic example on how to use it
*     if(!req.userInfo.isAdmin) {
*       return reject("nope"); // Equivalent to req.send("nope")
*     }
*     return resolve({"foo": "bar"}); // Equivalent to req.send(null, {"foo": "bar"})
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
