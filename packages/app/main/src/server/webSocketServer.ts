//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Framework Emulator Github:
// https://github.com/Microsoft/BotFramwork-Emulator
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import { createServer, Server, Request, Response } from 'restify';
import { Server as WSServer } from 'ws';

// can't import WebSocket type from ws types :|
interface WebSocket {
  close(): void;
  send(data: any, cb?: (err?: Error) => void): void;
}

export class WebSocketServer {
  private static _restServer: Server;
  private static _servers: { [conversationId: string]: WSServer } = {};
  private static _sockets: { [conversationId: string]: WebSocket } = {};

  public static getSocketByConversationId(conversationId: string): WebSocket {
    return this._sockets[conversationId];
  }

  public static init(): void {
    this._restServer = createServer({ handleUpgrades: true, name: 'Emulator-WebSocket-Host' });
    this._restServer.get('/ws/:conversationId', (req: Request, res: Response, next) => {
      const conversationId = req.params.conversationId;
      if (!(res as any).claimUpgrade) {
        return next(new Error('Connection must upgrade for web sockets.'));
      }

      const { head, socket } = (res as any).claimUpgrade();

      // initialize a new web socket server for each new conversation
      if (conversationId && !this._servers[conversationId]) {
        const wsServer = new WSServer({
          noServer: true,
        });
        wsServer.on('connection', (socket, req) => {
          console.log('got a connection for ', conversationId);
          this._sockets[conversationId] = socket;
          socket.on('message', data => {
            // will only receive (blank) data here when DLJS pings us to test the socket connection
          });
          socket.on('open', () => {
            // don't think we need to do anything here?
          });
          socket.on('close', (code, reason) => {
            console.log('got close for ', conversationId);
            delete this._servers[conversationId];
            delete this._sockets[conversationId];
          });
        });
        // upgrade the connection to a ws connection
        wsServer.handleUpgrade(req, socket, head, socket => {
          wsServer.emit('connection', socket, req);
        });
        this._servers[conversationId] = wsServer;
      }
    });
    this._restServer.listen(5005, () => {
      console.log('Web Socket host server listening on 5005...');
    });
  }

  public static cleanup(): void {
    for (const conversationId in this._sockets) {
      this._sockets[conversationId].close();
    }
    for (const conversationId in this._servers) {
      this._servers[conversationId].close();
    }
    this._restServer.close();
  }
}
