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

import { createJsonBodyParserMiddleware } from '../../utils/jsonBodyParser';
import { EmulatorRestServer } from '../../restServer';

import { addUsers } from './handlers/addUsers';
import { contactAdded } from './handlers/contactAdded';
import { contactRemoved } from './handlers/contactRemoved';
import { deleteUserData } from './handlers/deleteUserData';
import { createGetConversationHandler } from './handlers/getConversation';
import { getUsers } from './handlers/getUsers';
import { paymentComplete } from './handlers/paymentComplete';
import { ping } from './handlers/ping';
import { removeUsers } from './handlers/removeUsers';
import { sendTokenResponse } from './handlers/sendTokenResponse';
import { sendTyping } from './handlers/sendTyping';
import { updateShippingAddress } from './handlers/updateShippingAddress';
import { updateShippingOption } from './handlers/updateShippingOption';
import { createGetConversationEndpointHandler } from './handlers/getConversationEndpoint';
import { Emulator } from '../../../emulator';
//import { WebSocketServer } from '../../webSocketServer';

export function mountEmulatorRoutes(emulatorServer: EmulatorRestServer) {
  const { server, state } = emulatorServer;
  const getConversation = createGetConversationHandler(state);
  const jsonBodyParser = createJsonBodyParserMiddleware();

  server.get('/emulator/:conversationId/endpoint', createGetConversationEndpointHandler(state));

  server.get('/emulator/:conversationId/users', getConversation, getUsers);

  server.post('/emulator/:conversationId/users', jsonBodyParser, getConversation, addUsers);

  server.del('/emulator/:conversationId/users', getConversation, removeUsers);

  server.post('/emulator/:conversationId/contacts', getConversation, contactAdded);

  server.del('/emulator/:conversationId/contacts', getConversation, contactRemoved);

  server.post('/emulator/:conversationId/typing', getConversation, sendTyping);

  server.post('/emulator/:conversationId/ping', getConversation, ping);

  server.del('/emulator/:conversationId/userdata', getConversation, deleteUserData);

  server.post(
    '/emulator/:conversationId/invoke/updateShippingAddress',
    jsonBodyParser,
    getConversation,
    updateShippingAddress
  );

  server.post(
    '/emulator/:conversationId/invoke/updateShippingOption',
    jsonBodyParser,
    getConversation,
    updateShippingOption
  );

  server.post('/emulator/:conversationId/invoke/paymentComplete', jsonBodyParser, getConversation, paymentComplete);

  server.post('/emulator/:conversationId/invoke/sendTokenResponse', jsonBodyParser, sendTokenResponse);

  server.get('/emulator/users', (req, res, next) => {
    res.send(200, state.users);
    res.end();
    next();
  });

  // TODO: move to separate file
  // update the conversation object
  server.put('/emulator/:conversationId', jsonBodyParser, (req, res, next) => {
    const currentConversationId = req.params.conversationId;
    const { conversationId, userId } = req.body;
    const currentConversation = state.conversations.conversationById(currentConversationId);
    if (!currentConversationId) {
      res.send(404);
      return next();
    }

    // update the conversation object and reset as much as we can to resemble a new conversation
    state.conversations.deleteConversation(currentConversationId);
    currentConversation.conversationId = conversationId;
    currentConversation.user.id = userId;
    const user = currentConversation.members.find(member => member.name === 'User');
    user.id = userId;
    currentConversation.normalize();
    currentConversation.nextWatermark = 0;
    state.conversations.conversations[conversationId] = currentConversation;

    res.send(200, {
      // can't return the conversation object because event emitters are circular JSON
      botEndpoint: currentConversation.botEndpoint,
      conversationId: currentConversation.conversationId,
      user: currentConversation.user,
      mode: currentConversation.mode,
      members: currentConversation.members,
      nextWatermark: currentConversation.nextWatermark,
    });
    next();
  });

  // TODO: move to separate file
  server.post('/emulator/:conversationId/invoke/initialReport', jsonBodyParser, (req, res, next) => {
    const botUrl = req.body;
    const { conversationId } = req.params;
    emulatorServer.report(conversationId);
    Emulator.getInstance().ngrok.report(conversationId, botUrl);

    res.send(200);
    res.end();
    next();
  });
}
