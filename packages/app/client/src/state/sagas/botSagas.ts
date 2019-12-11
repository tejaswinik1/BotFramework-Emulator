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

import { newNotification, ResourceResponse, SharedConstants, UserSettings } from '@bfemulator/app-shared';
import { IEndpointService } from 'botframework-config';
import {
  CommandServiceImpl,
  CommandServiceInstance,
  ConversationService,
  StartConversationParams,
  uniqueIdv4,
} from '@bfemulator/sdk-shared';
import { call, ForkEffect, put, select, takeEvery, takeLatest } from 'redux-saga/effects';
import { encode } from 'base64url';
import { createCognitiveServicesSpeechServicesPonyfillFactory, createDirectLine } from 'botframework-webchat';
import { createStore as createWebChatStore } from 'botframework-webchat-core';

import { ActiveBotHelper } from '../../ui/helpers/activeBotHelper';
import {
  BotAction,
  BotActionType,
  BotConfigWithPathPayload,
  botHashGenerated,
  openBotViaUrlAction,
  RestartConversationPayload,
} from '../actions/botActions';
import { beginAdd } from '../actions/notificationActions';
import { generateHash } from '../helpers/botHelpers';
import { RootState } from '../store';
import * as ChatActions from '../actions/chatActions';
import { ChatDocument } from '../reducers/chat';

import { SharedSagas } from './sharedSagas';
import { open } from '../actions/editorActions';
import { ChatSagas } from './chatSagas';

const getWebSpeechFactoryForDocumentId = (state: RootState, documentId: string): (() => any) => {
  return state.chat.webSpeechFactories[documentId];
};

export class BotSagas {
  @CommandServiceInstance()
  private static commandService: CommandServiceImpl;

  public static *browseForBot(): IterableIterator<any> {
    yield call([ActiveBotHelper, ActiveBotHelper.confirmAndOpenBotFromFile]);
  }

  public static *generateHashForActiveBot(action: BotAction<BotConfigWithPathPayload>): IterableIterator<any> {
    const { bot } = action.payload;
    const generatedHash = yield call(generateHash, bot);
    yield put(botHashGenerated(generatedHash));
  }

  public static *openBotViaFilePath(action: BotAction<string>) {
    try {
      yield call([ActiveBotHelper, ActiveBotHelper.confirmAndOpenBotFromFile], action.payload);
    } catch (e) {
      const errorNotification = beginAdd(
        newNotification(`An Error occurred opening the bot at ${action.payload}: ${e}`)
      );
      yield put(errorNotification);
    }
  }

  // Currently restarts a conversation with an unchanged ID
  public static *restartConversation(action: BotAction<RestartConversationPayload>): IterableIterator<any> {
    const serverUrl = yield select((state: RootState) => state.clientAwareSettings.serverUrl);
    const { documentId, conversationId, user } = action.payload;
    let error;
    try {
      const endpointResponse: Response = yield ConversationService.getConversationEndpoint(serverUrl, conversationId);
      if (!endpointResponse.ok) {
        const error = yield endpointResponse.json();
        throw new Error(error.error.message);
      }

      const endpoint: IEndpointService = yield endpointResponse.json();

      const document: ChatDocument = yield select((state: RootState) => state.chat.chats[documentId]);
      // End the direct line connection
      if (document.directLine) {
        document.directLine.end();
      }
      document.directLine = null;
      yield put(ChatActions.clearLog(documentId));
      // Restart the conversation. This is an async
      // saga and is critical to wait for completion
      // until the next item is processed.
      let resolver = null;
      const awaiter = new Promise(resolve => {
        resolver = resolve;
      });
      yield put(ChatActions.restartConversation(documentId, false, false, resolver));
      yield awaiter;

      yield put(ChatActions.setInspectorObjects(documentId, []));

      yield* BotSagas.openBotViaUrl(
        openBotViaUrlAction({
          conversationId,
          appPassword: endpoint.appPassword,
          appId: endpoint.appId,
          endpoint: endpoint.endpoint,
          mode: document.mode,
          user,
        })
      );
    } catch (e) {
      error = '' + e;
    }

    if (error) {
      const errorNotification = beginAdd(newNotification(error));
      yield put(errorNotification);
    }
  }

  public static *openBotViaUrlV2(action: BotAction<StartConversationParams>): Iterable<any> {
    const user = {
      id: yield select((state: RootState) => state.framework.userGUID) || uniqueIdv4(), // use custom id or generate new one
      name: 'User',
      role: 'user',
    };
    const serverUrl = yield select((state: RootState) => state.clientAwareSettings.serverUrl);
    const payload = {
      botUrl: action.payload.endpoint,
      channelServiceType: action.payload.channelService,
      members: [user],
      mode: action.payload.mode,
      msaAppId: action.payload.appId,
      msaPassword: action.payload.appPassword,
    };
    const res: Response = yield ConversationService.startConversationV2(serverUrl, payload);
    if (!res.ok) {
      // error handling here
    }
    const { conversationId, endpointId }: { conversationId: string; endpointId: string } = yield res.json();
    const documentId = `${conversationId}`;

    // trigger chat saga that will populate the chat object in the store
    yield ChatSagas.newChatV2({
      conversationId,
      documentId,
      endpointId,
      mode: action.payload.mode,
      msaAppId: action.payload.appId,
      msaPassword: action.payload.appPassword,
      user,
    });

    // add a document to the store so the livechat tab is rendered
    const { CONTENT_TYPE_DEBUG, CONTENT_TYPE_LIVE_CHAT } = SharedConstants.ContentTypes;
    yield put(
      open({
        contentType: action.payload.mode === 'debug' ? CONTENT_TYPE_DEBUG : CONTENT_TYPE_LIVE_CHAT,
        documentId,
        isGlobal: false,
      })
    );

    // do debug POST here and also telemetry
  }

  public static *doChatSagasStuff(payload: any): Iterator<any> {
    // here we do web chat prep
    const { conversationId, documentId, endpointId, mode, msaAppId, msaPassword, user } = payload;
    // Create a new webchat store for this documentId
    yield put(ChatActions.webChatStoreUpdated(documentId, createWebChatStore()));
    // Each time a new chat is open, retrieve the speech token
    // if the endpoint is speech enabled and create a bound speech
    // pony fill factory. This is consumed by WebChat...
    yield put(ChatActions.webSpeechFactoryUpdated(documentId, undefined)); // remove the old factory

    // here we create the directline object
    const serverUrl = yield select((state: RootState) => state.clientAwareSettings.serverUrl);
    const options = {
      conversationId,
      mode,
      endpointId,
      userId: user.id,
    };
    const secret = encode(JSON.stringify(options));
    const directLine = createDirectLine({
      token: 'mytoken',
      conversationId: options.conversationId,
      secret,
      domain: `${serverUrl}/v3/directline`,
      webSocket: true,
      streamUrl: 'ws://localhost:5005',
    });

    // update chat document
    yield put(
      ChatActions.newChat(documentId, mode, {
        conversationId,
        directLine,
        userId: user.id,
      })
    );

    // here we do speech stuff if necessary
    if (!msaAppId && !msaPassword) {
      // speech is not enabled, we are done
      return;
    }

    // Get a token for speech and setup speech integration with Web Chat
    yield put(ChatActions.updatePendingSpeechTokenRetrieval(true));
    // If an existing factory is found, refresh the token
    const existingFactory: string = yield select(getWebSpeechFactoryForDocumentId, documentId);
    const { GetSpeechToken: command } = SharedConstants.Commands.Emulator;

    try {
      const speechAuthenticationToken: Promise<string> = BotSagas.commandService.remoteCall(
        command,
        endpointId,
        !!existingFactory
      );

      const factory = yield call(createCognitiveServicesSpeechServicesPonyfillFactory, {
        authorizationToken: speechAuthenticationToken,
        region: 'westus', // Currently, the prod speech service is only deployed to westus
      });

      yield put(ChatActions.webSpeechFactoryUpdated(documentId, factory)); // Provide the new factory to the store
    } catch (e) {
      // No-op - this appId/pass combo is not provisioned to use the speech api
    }

    yield put(ChatActions.updatePendingSpeechTokenRetrieval(false));
  }

  public static *openBotViaUrl(action: BotAction<Partial<StartConversationParams>>) {
    const serverUrl = yield select((state: RootState) => state.clientAwareSettings.serverUrl);
    if (!action.payload.user) {
      // If no user is provided, select the current user
      const customUserId = yield select((state: RootState) => state.framework.userGUID);
      const users: UserSettings = yield select((state: RootState) => state.clientAwareSettings.users);
      action.payload.user = customUserId || users.usersById[users.currentUserId];
      if (customUserId) {
        action.payload.user = customUserId;
        yield call(
          [BotSagas.commandService, BotSagas.commandService.remoteCall],
          SharedConstants.Commands.Emulator.SetCurrentUser,
          customUserId
        );
      }
    }
    let error;
    try {
      const response: Response = yield ConversationService.startConversation(serverUrl, action.payload);

      if (!response.ok) {
        error = `An Error occurred opening the bot at ${action.payload.endpoint}: ${response.statusText}`;
      }

      if (action.payload.mode === 'debug') {
        // extract the conversation id from the body
        const parsedBody = yield response.json();
        const conversationId = parsedBody.id || '';
        if (conversationId) {
          // post debug init command to conversation
          const activity = {
            type: 'message',
            text: '/INSPECT open',
          };
          const postActivityResponse: ResourceResponse & {
            statusCode: number;
            response?: { message: string; status: number | string };
          } = yield call(
            [BotSagas.commandService, BotSagas.commandService.remoteCall],
            SharedConstants.Commands.Emulator.PostActivityToConversation,
            conversationId,
            activity
          );
          if (postActivityResponse.statusCode > 399) {
            const { message = 'Message unavailable.', status = 'Status unavailable' } =
              postActivityResponse.response || {};
            error =
              `An error occurred while POSTing "/INSPECT open" command to conversation ${conversationId}: ` +
              `${status}: ${message}`;
          }
        } else {
          error = 'An error occurred while trying to grab conversation ID from the new conversation.';
        }
      }
    } catch (e) {
      error = e.message;
    }
    if (error) {
      const errorNotification = beginAdd(newNotification(error));
      yield put(errorNotification);
    } else {
      // remember the endpoint
      yield call(
        [BotSagas.commandService, BotSagas.commandService.remoteCall],
        SharedConstants.Commands.Settings.SaveBotUrl,
        action.payload.endpoint
      );
      BotSagas.commandService.remoteCall(SharedConstants.Commands.Telemetry.TrackEvent, 'bot_open', {
        method: null, // this code path can be hit by multiple methods
        numOfServices: 0,
        source: 'url',
      });
    }
  }
}

export function* botSagas(): IterableIterator<ForkEffect> {
  yield takeEvery(BotActionType.browse, BotSagas.browseForBot);
  yield takeEvery(BotActionType.openViaUrl, BotSagas.openBotViaUrlV2);
  yield takeEvery(BotActionType.openViaFilePath, BotSagas.openBotViaFilePath);
  yield takeEvery(BotActionType.restartConversation, BotSagas.restartConversation);
  yield takeEvery(BotActionType.setActive, BotSagas.generateHashForActiveBot);
  yield takeLatest(
    [BotActionType.setActive, BotActionType.load, BotActionType.close],
    SharedSagas.refreshConversationMenu
  );
}
