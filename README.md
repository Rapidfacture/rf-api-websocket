# rf-api-websocket

rf-api implementation for RPC over websockets using JSON messages with optional ACL.

NOTE: Alpha!

##  ws server
* Uses express server instance
* Websocket communication service
* Allows safe RPC
* Uses JSON messages

## ws methods

### addHandler
Add a simple callback handler.
Errors can be signalled via exceptions
Any previous handler with the same func name will be replaced.
```js
services.addHandler (funcName, callback, acl = {})
```
* `funcName` The name of the handler. In order for the handler to be called, this needs to be used
in the func attribute of the received websocket message.
* `callback` The handler function(msg, responseCallback(msg))
* `acl` Optional ACD configuraton

### addPromiseHandler
Add a promise callback handler that either resolves to null (no response) or to
response data and signals exceptions via rejection (logged, no response.
Any previous handler with the same func name will be replaced.
```js
services.addPromiseHandler (funcName, genPromise, acl = {})
```
* `funcName` The name of the handler. In order for the handler to be called, this needs to be used
in the func attribute of the received websocket message.
* `callback` The handler function(msg, responseCallback(msg))
* `acl` Optional ACD configuraton

### sendObj
```js
services.sendObj (ws, obj)
```
TODO: integrate callbackID
maybe one raw send method, and one preconfigured (default to use)

### broadcast
Send the given object to ALL the currently connected websockets
NOTE: This sends the object as-is.
```js
services.broadcast (obj)
```

## Getting started

When the module is started, the websocket server and handler is automatically
registered against the HTTP server. You dont need to start the server manually!

Websocket messages have the form:
{func: "<function>", data: {...}, token: "<optional JWT token>"}
Any other attributes are copied to the response

Register a handler like this:
```js
API.onWSMessage("myfunc", (msg, respondWS, userInfo) => {
    // userInfo contains the object extracted from the JWT (or {} if no token was supplied)
    // If the user does not have the required permissions or the message is malformed,
    // this function is not called but instead an error msg is sent!
    if(!userInfo.isAdmin) {
      return false;
    }
    // Handle message (msg is .data of the original message)
    console.log(msg.foobar)
    // Then send response. Convention is to have an err attribute
    respondWS({err: null, info: "It works"});
    // NOTE: You can call respondWS multiple times if required!
}, {}) // Empty ACL => no auth required
```

See the `rf-acl` package for documentation about the ACL syntax

If you are using Promises, use this syntax
```js
API.onWSMessagePromise("myfunc", (msg, respondWS, userInfo) => {
  return new Promise((resolve, reject) => {
    if(!userInfo.isAdmin) {
      return reject("nope"); // Will send {err: "nope"}
    }
    return resolve({"foo": "bar"}); // will send {err: null, "foo": "bar"}
  });
}, {}) // Empty ACL => no auth required
```

## PeerDependencies
* `rf-log`
* `rf-load`
* `rf-api`
* rapidfacture `http` file

## Development

Install the dev tools with
> npm install

Then you can runs some test cases and eslint with:
> npm test

Generate Docs:
> npm run-script doc

## To Do
* get the everything running

## Legal Issues
* License: MIT
* Author: Rapidfacture GmbH
