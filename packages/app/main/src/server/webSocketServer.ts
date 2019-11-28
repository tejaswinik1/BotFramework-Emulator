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

import { Server } from 'ws';

export class WebSocketServer {
  private static _server: Server;
  private static _socket: any;

  public static init(): void {
    if (!this._server) {
      this._server = new Server({
        host: 'localhost', // TODO: potentially add a setting here that uses localhost override?
        port: 5005,
      });
      // listen for connections
      // this._server.on('connection', this.onConnection);
      let numCon = 0;
      let numData = 0;
      this._server.on('connection', (socket, req) => {
        console.log('got a connection: ', numCon++);
        this._socket = socket;
        socket.on('message', data => {
          console.log('got data: ', numData++);
        });
        socket.on('open', () => {
          console.log('Got open.');
        });
      });
      console.log('Server initialized');
    }
  }

  public static send(data: any): void {
    if (this._socket) {
      this._socket.send(JSON.stringify(data));
    }
  }
}
