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

//import { ResourceResponse } from '@bfemulator/sdk-shared';
import { Activity } from 'botframework-schema';
import * as HttpStatus from 'http-status-codes';
import { Next, Request, Response } from 'restify';

import { OAuthLinkEncoder } from '../../../../utils/oauthLinkEncoder';
import { sendErrorResponse } from '../../../../utils/sendErrorResponse';
import { ConversationAPIPathParameters } from '../types/conversationAPIPathParameters';
import { EmulatorRestServer } from '../../../../restServer';
import { WebSocketServer } from '../../../../webSocketServer';

export function createReplyToActivityHandler(emulatorServer: EmulatorRestServer) {
  return (req: Request, res: Response, next: Next): any => {
    let activity = req.body as Activity;
    const conversationParameters: ConversationAPIPathParameters = req.params;
    const { logger } = emulatorServer;

    try {
      activity.id = activity.id || null;
      activity.replyToId = req.params.activityId;

      // TODO: make sure all this stuff works with transcripts
      const continuation = function(): void {
        //const response: ResourceResponse = (req as any).conversation.postActivityToUser(activity);
        const { conversation } = req as any;

        // processing
        activity = conversation.postage(conversation.user.id, activity, false);
        if (!activity.from.name) {
          activity.from.name = 'Bot';
        }

        if (activity.name === 'ReceivedActivity') {
          activity.value.from.role = 'user';
        } else if (activity.name === 'SentActivity') {
          activity.value.from.role = 'bot';
        }

        if (!activity.locale) {
          activity.locale = conversation.emulatorServer.state.locale;
        }

        // Fill in role field, if missing
        if (!activity.recipient.role) {
          activity.recipient.role = 'user';
        }
        const payload = { activities: [activity] };
        WebSocketServer.send(payload);

        //res.send(HttpStatus.OK, response);
        res.send(HttpStatus.OK, { id: activity.id });
        res.end();
      };

      const { conversationId } = conversationParameters;
      const visitor = new OAuthLinkEncoder(
        emulatorServer,
        req.headers.authorization as string,
        activity,
        conversationId
      );
      visitor
        .resolveOAuthCards(activity)
        .then(_ => {
          continuation();
        })
        .catch(
          // failed to generate an OAuth signin link
          (reason: any) => {
            logger.logException(conversationId, reason);
            logger.logException(conversationId, new Error('Falling back to emulated OAuth token.'));
            continuation();
          }
        );
    } catch (err) {
      sendErrorResponse(req, res, next, err);
    }

    next();
  };
}
