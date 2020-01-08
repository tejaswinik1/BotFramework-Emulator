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

import { newNotification, SharedConstants } from '@bfemulator/app-shared';
import {
  CommandServiceImpl,
  CommandServiceInstance,
  ConversationService,
  StartConversationParams,
  uniqueIdv4,
  User,
  isLocalHostUrl,
} from '@bfemulator/sdk-shared';
import { call, ForkEffect, put, select, takeEvery, takeLatest } from 'redux-saga/effects';

import { ActiveBotHelper } from '../../ui/helpers/activeBotHelper';
import { BotAction, BotActionType, BotConfigWithPathPayload, botHashGenerated } from '../actions/botActions';
import { beginAdd } from '../actions/notificationActions';
import { generateHash } from '../helpers/botHelpers';
import { RootState } from '../store';

import { SharedSagas } from './sharedSagas';
import { open } from '../actions/editorActions';
import { ChatSagas } from './chatSagas';

const getServerUrl = (state: RootState): string => {
  return state.clientAwareSettings.serverUrl;
};

const getCustomUserGUID = (state: RootState): string => {
  return state.framework.userGUID;
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

  public static *openBotViaUrl(
    action: BotAction<StartConversationParams & { isFromBotFile?: boolean }>
  ): Iterable<any> {
    const user = {
      id: yield select(getCustomUserGUID) || uniqueIdv4(), // use custom id or generate new one
      name: 'User',
      role: 'user',
    };
    const serverUrl = yield select(getServerUrl);
    const payload = {
      botUrl: action.payload.endpoint,
      channelServiceType: action.payload.channelService,
      members: [user],
      mode: action.payload.mode,
      msaAppId: action.payload.appId,
      msaPassword: action.payload.appPassword,
    };
    let res: Response = yield ConversationService.startConversation(serverUrl, payload);
    if (!res.ok) {
      throw new Error(
        `Error occurred while starting a new conversation: ${res.status}: ${res.statusText || 'No status text'}`
      );
    }
    const {
      conversationId,
      endpointId,
      members,
    }: { conversationId: string; endpointId: string; members: User[] } = yield res.json();
    const documentId = `${conversationId}`;

    // trigger chat saga that will populate the chat object in the store
    yield ChatSagas.bootstrapChat({
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

    // call emulator to report proper status to chat panel (listening / ngrok)
    res = yield ConversationService.sendInitialLogReport(serverUrl, conversationId, action.payload.endpoint);
    if (!res.ok) {
      throw new Error(
        `Error occurred while sending the initial log report: ${res.status}: ${res.statusText || 'No status text'}`
      );
    }

    // send CU or debug INSPECT message
    res = yield ChatSagas.sendInitialActivity({ conversationId, members, mode: action.payload.mode });
    if (!res.ok) {
      throw new Error(
        `Error occurred while sending the initial activities: ${res.status}: ${res.statusText || 'No status text'}`
      );
    }

    // remember the endpoint
    yield call(
      [BotSagas.commandService, BotSagas.commandService.remoteCall],
      SharedConstants.Commands.Settings.SaveBotUrl,
      action.payload.endpoint
    );

    // telemetry
    if (!action.payload.isFromBotFile) {
      BotSagas.commandService.remoteCall(SharedConstants.Commands.Telemetry.TrackEvent, 'bot_open', {
        numOfServices: 0,
        source: 'url',
      });
    }
    if (!isLocalHostUrl(action.payload.endpoint)) {
      BotSagas.commandService
        .remoteCall(SharedConstants.Commands.Telemetry.TrackEvent, 'livechat_openRemote')
        .catch(_e => void 0);
    }
  }
}

export function* botSagas(): IterableIterator<ForkEffect> {
  yield takeEvery(BotActionType.browse, BotSagas.browseForBot);
  yield takeEvery(BotActionType.openViaUrl, BotSagas.openBotViaUrl);
  yield takeEvery(BotActionType.openViaFilePath, BotSagas.openBotViaFilePath);
  yield takeEvery(BotActionType.setActive, BotSagas.generateHashForActiveBot);
  yield takeLatest(
    [BotActionType.setActive, BotActionType.load, BotActionType.close],
    SharedSagas.refreshConversationMenu
  );
}
