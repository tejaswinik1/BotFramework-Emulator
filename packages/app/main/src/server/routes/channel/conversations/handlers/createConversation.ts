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

import { ConversationParameters, ChannelAccount, ConversationAccount } from 'botframework-schema';
import * as HttpStatus from 'http-status-codes';
import { Next, Request, Response } from 'restify';
import { EmulatorMode } from '@bfemulator/sdk-shared';

import { BotEndpoint } from '../../../../state/botEndpoint';
import { Conversation } from '../../../../state/conversation';
import { createConversationResponse } from '../../../../utils/createResponse/createConversationResponse';
import { sendErrorResponse } from '../../../../utils/sendErrorResponse';
import { uniqueId } from '../../../../utils/uniqueId';
import { EmulatorRestServer } from '../../../../restServer';

import { validateCreateConversationRequest } from './errorCondition/createConversationValidator';

function validateRequest(payload): any {
  if (!payload.bot) {
    return new Error('Missing bot object in request.');
  } else if (!payload.botEndpoint) {
    return new Error('Missing botEndpoint object in request.');
  } else if (payload.members.length !== 1 || payload.members[0].role !== 'user') {
    return new Error('Missing user inside of members array in request.');
  }
  return undefined;
}

export function createCreateConversationHandlerV2(emulatorServer: EmulatorRestServer) {
  return (req: Request, res: Response, next: Next): any => {
    // validate request
    const validationResult = validateRequest({
      ...req.body,
      botEndpoint: (req as any).botEndpoint,
    });
    if (validationResult) {
      res.send(403, validationResult); // bad request
      res.end();
      return next();
    }

    const { members, mode } = req.body;
    const { botEndpoint }: { botEndpoint: BotEndpoint } = req as any;
    const { conversations } = emulatorServer.state;

    const conversation = conversations.newConversation(
      emulatorServer,
      botEndpoint,
      members[0],
      undefined, // generate a conversation id
      mode
    );
    res.send(201, {
      conversationId: conversation.conversationId,
      endpointId: botEndpoint.id,
      members: conversation.members,
    });
    res.end();
    next();
  };
}

export function createCreateConversationHandler(emulatorServer: EmulatorRestServer) {
  return (req: Request, res: Response, next: Next): any => {
    const botEndpoint: BotEndpoint = (req as any).botEndpoint;
    const conversationParameters = req.body;
    const error = validateCreateConversationRequest(conversationParameters, botEndpoint);

    if (error) {
      sendErrorResponse(req, res, next, error.toAPIException());
      next();
      return;
    }

    const newConversation: Conversation = getConversation(conversationParameters, emulatorServer, botEndpoint);
    newConversation.normalize();

    const activityId = getActivityId(conversationParameters, botEndpoint, newConversation);
    const response = createConversationResponse(newConversation.conversationId, activityId);

    res.send(HttpStatus.OK, response);
    res.end();
    next();
  };
}

function getConversation(
  params: { conversationId: string; members: any[]; mode: EmulatorMode },
  emulatorServer: EmulatorRestServer,
  endpoint: BotEndpoint
): Conversation {
  const { state } = emulatorServer;
  let conversation: Conversation;

  if (params.conversationId) {
    conversation = state.conversations.conversationById(params.conversationId);
  }

  if (!conversation) {
    //TODO: we need to send the conversation updates here
    // (how is this going) to work with the new websocket model?
    const { members = [] } = params;
    const [member] = members;
    const currentUserId = state.users.currentUserId;
    const { id = currentUserId || uniqueId(), name = 'User' } = member || {};
    conversation = state.conversations.newConversation(
      emulatorServer,
      endpoint,
      { id, name },
      params.conversationId,
      params.mode
    );
  }

  return conversation;
}

function getActivityId(
  params: ConversationParameters,
  endpoint: BotEndpoint,
  conversation: Conversation
): string | null {
  const { activity, members } = params;
  if (activity) {
    // set routing information for new conversation
    activity.conversation = { id: conversation.conversationId } as ConversationAccount;
    activity.from = { id: endpoint.botId } as ChannelAccount;
    activity.recipient = { id: members[0].id } as ChannelAccount;

    const response = conversation.postActivityToUser(activity);

    return response.id;
  }

  return null;
}
