
const WebSocketServer = require('ws').Server;
const log =  require('rf-log');
const util = require('util');

class CallbackHandler {
    constructor(name, callback, acl, log) {
        this.name = name;
        this.callback = callback;
        this.acl = acl;
        this.log = log;
    }

    Handle(data, send) {
        this.callback(data, send);
    }
}

class WebsocketServer {
    constructor(http) {
        // All active connections for broadcast
        this.allWS = [];
        this.handlers = {}; // func name => handler(msg, responseCallback(err, ))
        // Initialize server
        const http = require('rf-load').require('http');
        this.server = new WebSocketServer({
            server: http.server
        });
        server.on('connection', onConnection);
    }

    /**
     * Add a simple callback handler. Any previous handler with the same func name will be replaced.
     * @param {*} funcName The name of the handler. In order for the handler to be called, this needs to be used
     * in the func attribute of the websocket message.
     * @param {*} handler The handler function(msg, responseCallback(msg))
     * @param {*} acl Optional ACD configuraton
     */
    AddHandler(funcName, handler, acl={}) {
        this.handlers[funcName] = new CallbackHandler(funcName, handler, acl, log);
    }

    onConnection(server) {
        log.info(`websocket connection open: ${ws.upgradeReq.url}`)
        this.allWS.push(ws);
        //console.log(ws.upgradeReq.url);
        ws.on('message', (data, flags) => this.onMessage(ws, data, flags));
        ws.on('close', () => this.onClose(ws))
    }
    
    onClose(ws) {
        log.info('websocket connection close')
        // Remove from allWS list
        let idx = this.allWS.indexOf(ws);
        if(idx > -1) {
            this.allWS.splice(idx, 1);
        }
    }
    
    onMessage(ws, data, flags) {
        try {
            let msg = JSON.parse(data)
        } catch (ex) {
            return this.log.error(`Failed to parse websocket message JSON: ${ex}`)
        }
        this.log.info('websocket message received')
        // Check msg validity
        if(!msg.func) {
            return this.log.error(`Received websocket message without specified func: ${util.inspect(msg)}`);
        }
        if (!msg.data) {
            return this.log.error(`Received websocket message without any data: ${util.inspect(msg)}`);
        }
        const data = msg.data;
        // Prepare "prototype" (to be sent back), i.e. keep anything besides 'data'
        const protoObj = msg;
        delete protoObj.data;
        // Try to find correct function
        const func = msg.func;
        const handler = this.handlers[func]
        if(!handler) {
            return this.log.error(`Can't find any handler for function ${func}`);
        }
        this.log.info(`Received correct websocket message with func ${func}`);
        // Call handler with custom "send" callback
        return handler.handle(data, newData => {
            // NOTE: Multiple calls will
            const wsObj = protoObj;
            wsObj.data = newData;
            return this.sendObj(wsObj);
        })
    }

    sendObj(ws, obj) {
        try {
            return ws.send(JSON.stringify(obj));
        } catch(err) {
            this.log.error(`Failed to send websocket message: ${err}`);
        }
    }
}

module.exports.start = function (options, startNextModule) {

    API.Services.registerFunction(WebsocketServer)
    startNextModule()
}
