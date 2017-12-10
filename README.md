# rf-api-websocket

rf-api implementation for RPC over websockets using JSON messages with optional ACL.
NOTE: Alpha!

##  ws server
* uses express server instance
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

## PeerDependencies
* `rf-log`
* `rf-load`
* `rf-api`
* rapidfacture `http` file

## Development

Install the dev tools with

Then you can runs some test cases and eslint with:
> npm test

Generate Docs:
> npm run-script doc

## To Do
* get the everything running

## Legal Issues
* License: MIT
* Author: Rapidfacture GmbH
