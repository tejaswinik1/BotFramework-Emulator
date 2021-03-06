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
import { SharedConstants } from '@bfemulator/app-shared';
import * as React from 'react';
import { Provider } from 'react-redux';
import { mount } from 'enzyme';
import { combineReducers, createStore } from 'redux';
import { ServiceTypes } from 'botframework-config';

import { azureAuth } from '../../../state/reducers/azureAuth';
import { DialogService } from '../service';
import { executeCommand } from '../../../state/actions/commandActions';

import { ConnectServicePromptDialog } from './connectServicePromptDialog';
import { ConnectServicePromptDialogContainer } from './connectServicePromptDialogContainer';

jest.mock('../service', () => ({
  DialogService: {
    showDialog: () => Promise.resolve(true),
    hideDialog: () => Promise.resolve(false),
  },
}));

jest.mock('../dialogStyles.scss', () => ({}));

const mockStore = createStore(combineReducers({ azureAuth }));
jest.mock('../../../state/store', () => ({
  get store() {
    return mockStore;
  },
}));

jest.mock('../../dialogs/', () => ({
  AzureLoginPromptDialogContainer: () => undefined,
  AzureLoginSuccessDialogContainer: () => undefined,
  BotCreationDialog: () => undefined,
  DialogService: { showDialog: () => Promise.resolve(true) },
  SecretPromptDialog: () => undefined,
}));

describe('The ConnectServicePromptDialog component should', () => {
  let mockStore;
  let mockDispatch;
  let parent;
  let node;
  let instance: any;

  beforeEach(() => {
    mockStore = createStore(azureAuth);
    mockDispatch = jest.spyOn(mockStore, 'dispatch');
    parent = mount(
      <Provider store={mockStore}>
        <ConnectServicePromptDialogContainer serviceType={ServiceTypes.Luis} />
      </Provider>
    );
    node = parent.find(ConnectServicePromptDialog);
    instance = node.instance() as ConnectServicePromptDialog;
  });

  it('should render deeply', () => {
    expect(parent.find(ConnectServicePromptDialogContainer)).not.toBe(null);
  });

  it('should contain both a cancel and confirm function in the props', () => {
    const prompt = parent.find(ConnectServicePromptDialog);
    expect(typeof (prompt.props() as any).cancel).toBe('function');
    expect(typeof (prompt.props() as any).confirm).toBe('function');
  });

  it('should exit with code 0 when the user cancels the dialog', () => {
    const spy = jest.spyOn(DialogService, 'hideDialog');
    const instance = node.instance();
    instance.props.cancel();
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('should exit with code 1 when the confirmation is selected', () => {
    const spy = jest.spyOn(DialogService, 'hideDialog');
    const instance = node.instance();
    instance.props.confirm();
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('should exit with code 2 when add luis apps manually is selected', () => {
    const spy = jest.spyOn(DialogService, 'hideDialog');
    const instance = node.instance();
    instance.props.addServiceManually();
    expect(spy).toHaveBeenCalledWith(2);
  });

  it('should call the appropriate command when onAnchorClick is called', () => {
    instance.props.onAnchorClick('http://blah');
    expect(mockDispatch).toHaveBeenCalledWith(
      executeCommand(true, SharedConstants.Commands.Electron.OpenExternal, null, 'http://blah')
    );
  });
});
