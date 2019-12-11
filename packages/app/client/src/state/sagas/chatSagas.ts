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
import * as Electron from 'electron';
import { MenuItemConstructorOptions } from 'electron';
import { Activity } from 'botframework-schema';
import { SharedConstants, ValueTypes, newNotification } from '@bfemulator/app-shared';
import {
  CommandServiceImpl,
  CommandServiceInstance,
  ConversationService,
  uniqueIdv4,
  uniqueId,
} from '@bfemulator/sdk-shared';
import { IEndpointService } from 'botframework-config/lib/schema';
import { createCognitiveServicesSpeechServicesPonyfillFactory, createDirectLine } from 'botframework-webchat';
import { createStore as createWebChatStore } from 'botframework-webchat-core';
import { call, ForkEffect, put, select, takeEvery, takeLatest } from 'redux-saga/effects';
import { encode } from 'base64url';

import {
  ChatAction,
  ChatActions,
  closeDocument,
  DocumentIdPayload,
  updatePendingSpeechTokenRetrieval,
  webChatStoreUpdated,
  webSpeechFactoryUpdated,
  newConversation,
  NewChatDocumentPayload,
  RestartConversationPayload,
  newChat,
} from '../actions/chatActions';
import { RootState } from '../store';
import { isSpeechEnabled } from '../../utils';
import { ChatDocument } from '../reducers/chat';

const getConversationIdFromDocumentId = (state: RootState, documentId: string) => {
  return (state.chat.chats[documentId] || { conversationId: null }).conversationId;
};

const getWebSpeechFactoryForDocumentId = (state: RootState, documentId: string): (() => any) => {
  return state.chat.webSpeechFactories[documentId];
};

const getEndpointServiceByDocumentId = (state: RootState, documentId: string): IEndpointService => {
  const chat = state.chat.chats[documentId];
  return ((state.bot.activeBot && state.bot.activeBot.services) || []).find(
    s => s.id === chat.endpointId
  ) as IEndpointService;
};

const getChatFromDocumentId = (state: RootState, documentId: string): ChatDocument => {
  return state.chat.chats[documentId];
};

const getCustomUserGUID = (state: RootState): string => {
  return state.framework.userGUID;
};

export class ChatSagas {
  @CommandServiceInstance()
  private static commandService: CommandServiceImpl;

  public static *showContextMenuForActivity(action: ChatAction<Activity>): Iterable<any> {
    const { payload: activity } = action;
    const menuItems = [
      { label: 'Copy text', id: 'copy' },
      { label: 'Copy json', id: 'json' },
    ] as MenuItemConstructorOptions[];

    const { DisplayContextMenu } = SharedConstants.Commands.Electron;
    const response: { id: string } = yield call(
      [ChatSagas.commandService, ChatSagas.commandService.remoteCall],
      DisplayContextMenu,
      menuItems
    );

    if (!response) {
      return; // canceled context menu
    }
    switch (response.id) {
      case 'copy':
        return Electron.clipboard.writeText(ChatSagas.getTextFromActivity(activity));

      case 'json':
        return Electron.clipboard.writeText(JSON.stringify(activity, null, 2));

      default:
        return;
    }
  }

  public static *closeConversation(action: ChatAction<DocumentIdPayload>): Iterable<any> {
    const conversationId = yield select(getConversationIdFromDocumentId, action.payload.documentId);
    const { DeleteConversation } = SharedConstants.Commands.Emulator;
    const { documentId } = action.payload;
    const chat = yield select(getChatFromDocumentId, documentId);
    if (chat && chat.directLine) {
      chat.directLine.end(); // stop polling
    }
    yield put(closeDocument(documentId));
    // remove the webchat store when the document is closed
    yield put(webChatStoreUpdated(documentId, null));
    yield call([ChatSagas.commandService, ChatSagas.commandService.remoteCall], DeleteConversation, conversationId);
  }

  public static *newChatV2(payload: any): Iterable<any> {
    const { conversationId, documentId, endpointId, mode, msaAppId, msaPassword, user } = payload;
    // Create a new webchat store for this documentId
    yield put(webChatStoreUpdated(documentId, createWebChatStore()));
    // Each time a new chat is open, retrieve the speech token
    // if the endpoint is speech enabled and create a bound speech
    // pony fill factory. This is consumed by WebChat...
    yield put(webSpeechFactoryUpdated(documentId, undefined)); // remove the old factory

    // create the DL object and update the chat in the store
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

    yield put(
      newChat(documentId, mode, {
        conversationId,
        directLine,
        userId: user.id,
      })
    );

    // if speech is not enabled, we are done
    if (!msaAppId && !msaPassword) {
      return;
    }

    // Get a token for speech and setup speech integration with Web Chat
    yield put(updatePendingSpeechTokenRetrieval(true));
    // If an existing factory is found, refresh the token
    const existingFactory: string = yield select(getWebSpeechFactoryForDocumentId, documentId);
    const { GetSpeechToken: command } = SharedConstants.Commands.Emulator;

    try {
      const speechAuthenticationToken: Promise<string> = ChatSagas.commandService.remoteCall(
        command,
        endpointId,
        !!existingFactory
      );

      const factory = yield call(createCognitiveServicesSpeechServicesPonyfillFactory, {
        authorizationToken: speechAuthenticationToken,
        region: 'westus', // Currently, the prod speech service is only deployed to westus
      });

      yield put(webSpeechFactoryUpdated(documentId, factory)); // Provide the new factory to the store
    } catch (e) {
      // No-op - this appId/pass combo is not provisioned to use the speech api
    }

    yield put(updatePendingSpeechTokenRetrieval(false));
  }

  public static *newChat(action: ChatAction<NewChatDocumentPayload & RestartConversationPayload>): Iterable<any> {
    const { documentId, requireNewConversationId, requireNewUserId, resolver } = action.payload;
    // Create a new webchat store for this documentId
    yield put(webChatStoreUpdated(documentId, createWebChatStore()));
    // Each time a new chat is open, retrieve the speech token
    // if the endpoint is speech enabled and create a bound speech
    // pony fill factory. This is consumed by WebChat...
    yield put(webSpeechFactoryUpdated(documentId, undefined)); // remove the old factory

    // create the new directline object, and update the user / conversation ids if necessary
    const endpoint: IEndpointService = yield ChatSagas.initializeConversation(
      documentId,
      requireNewConversationId,
      requireNewUserId
    );

    // If speech is not enabled we are done here
    if (!isSpeechEnabled(endpoint)) {
      if (resolver) {
        resolver();
      }
      return;
    }

    // Get a token for speech and setup speech integration with Web Chat
    yield put(updatePendingSpeechTokenRetrieval(true));
    // If an existing factory is found, refresh the token
    const existingFactory: string = yield select(getWebSpeechFactoryForDocumentId, documentId);
    const { GetSpeechToken: command } = SharedConstants.Commands.Emulator;

    try {
      const speechAuthenticationToken: Promise<string> = ChatSagas.commandService.remoteCall(
        command,
        endpoint.id,
        !!existingFactory
      );

      const factory = yield call(createCognitiveServicesSpeechServicesPonyfillFactory, {
        authorizationToken: speechAuthenticationToken,
        region: 'westus', // Currently, the prod speech service is only deployed to westus
      });

      yield put(webSpeechFactoryUpdated(documentId, factory)); // Provide the new factory to the store
    } catch (e) {
      // No-op - this appId/pass combo is not provisioned to use the speech api
    }

    yield put(updatePendingSpeechTokenRetrieval(false));

    if (resolver) {
      resolver();
    }
  }

  // Creates DL object and updates the corresponding chat document in state
  public static *initializeConversation(
    documentId: string,
    requireNewConversationId: boolean,
    requireNewUserId: boolean
  ): Iterable<any> {
    const chat: ChatDocument = yield select(getChatFromDocumentId, documentId);
    const { mode } = chat;
    const serverUrl = yield select((state: RootState) => state.clientAwareSettings.serverUrl);

    // set user id
    let userId;
    if (requireNewUserId) {
      userId = uniqueIdv4();
    } else {
      // use the previous id or the custom id from settings
      userId = chat.userId || (yield select(getCustomUserGUID));
    }
    yield ChatSagas.commandService.remoteCall(SharedConstants.Commands.Emulator.SetCurrentUser, userId);

    let conversationId;
    if (requireNewConversationId) {
      conversationId = `${uniqueId()}|${mode}`;
    } else {
      // perserve the current conversation id
      conversationId = chat.conversationId || `${uniqueId()}|${mode}`;
    }

    // update the main-side conversation object with conversation & user IDs,
    // and ensure that conversation is in a fresh state
    let res: Response = yield ConversationService.updateConversation(serverUrl, chat.conversationId, {
      conversationId,
      userId,
    });
    // TODO: error handling here (if 404, blah)

    res = yield ConversationService.getConversationEndpoint(serverUrl, chat.conversationId);
    const endpoint: any = yield res.json();
    // TODO: more error handling here

    // create the directline object
    const options = {
      conversationId,
      mode,
      endpointId: endpoint.id,
      userId,
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
      newConversation(documentId, {
        conversationId,
        directLine,
        userId,
        mode,
      })
    );
    return endpoint;
  }

  private static getTextFromActivity(activity: Activity): string {
    if (activity.valueType === ValueTypes.Command) {
      return activity.value;
    } else if (activity.valueType === ValueTypes.Activity) {
      return 'text' in activity.value ? activity.value.text : activity.label;
    }
    return activity.text || activity.label || '';
  }
}

export function* chatSagas(): IterableIterator<ForkEffect> {
  yield takeEvery(ChatActions.showContextMenuForActivity, ChatSagas.showContextMenuForActivity);
  yield takeEvery(ChatActions.closeConversation, ChatSagas.closeConversation);
  yield takeLatest([ChatActions.newChat, ChatActions.restartConversation], ChatSagas.newChat);
  yield takeEvery('--NEW-CHAT', ChatSagas.newChatV2);
}
