import React from 'react';
import { createRoot } from 'react-dom/client';
import { settingsManager, WTrackerSettings } from './components/Settings.js';

import { buildPrompt, Message } from 'sillytavern-utils-lib';
import { ChatMessage, EventNames } from 'sillytavern-utils-lib/types';
import { characters, name1, st_echo } from 'sillytavern-utils-lib/config';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { ExtensionSettings, PromptEngineeringMode, EXTENSION_KEY, extensionName } from './config.js';
import { parseResponse } from './parser.js';
import { schemaToExample } from './schema-to-example.js';
import { buildModeSequence, runWithRetry } from './generation.js';
import { buildOpenAIChatCompletionsUrl, isLocalOpenAIEndpoint, normalizeOpenAIMessageContent } from './openai-compat.js';
import {
  deleteTrackerForActiveSwipe,
  getTrackerForActiveSwipe,
  setTrackerForActiveSwipe,
  shouldAutoGenerateForRenderType,
} from './tracker-state.js';

import { POPUP_RESULT, POPUP_TYPE } from 'sillytavern-utils-lib/types/popup';
import * as Handlebars from 'handlebars';

// --- Constants and Globals ---
const CHAT_METADATA_SCHEMA_PRESET_KEY = 'schemaKey';
const CHAT_MESSAGE_SCHEMA_VALUE_KEY = 'value';
const CHAT_MESSAGE_SCHEMA_HTML_KEY = 'html';

const globalContext = SillyTavern.getContext();
const pendingRequests = new Map<number, AbortController>();
const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

// --- Handlebars Helper ---
if (!Handlebars.helpers['join']) {
  Handlebars.registerHelper('join', function (array: any, separator: any) {
    if (Array.isArray(array)) {
      return array.join(typeof separator === 'string' ? separator : ', ');
    }
    return '';
  });
}

// --- Core Logic Functions (ported from original index.ts) ---

function renderTracker(messageId: number) {
  const message = globalContext.chat[messageId];
  const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
  messageBlock?.querySelector('.mes_wtracker')?.remove();

  const tracker = getTrackerForActiveSwipe(message);
  if (!tracker) return;

  const trackerData = tracker.value;
  const trackerHtmlSchema = tracker.html;
  if (!trackerData || !trackerHtmlSchema) return;

  if (!messageBlock) return;

  const template = Handlebars.compile(trackerHtmlSchema, { noEscape: true, strict: true });
  const renderedHtml = template({ data: trackerData });

  const container = document.createElement('div');
  container.className = 'mes_wtracker';
  container.innerHTML = renderedHtml;

  // Add controls
  const controls = document.createElement('div');
  controls.className = 'wtracker-controls';
  controls.innerHTML = `
    <div class="wtracker-regenerate-button fa-solid fa-arrows-rotate" title="Regenerate Tracker"></div>
    <div class="wtracker-edit-button fa-solid fa-code" title="Edit Tracker Data"></div>
    <div class="wtracker-delete-button fa-solid fa-trash-can" title="Delete Tracker"></div>
  `;
  container.prepend(controls);

  messageBlock.querySelector('.mes_text')?.before(container);
}

function includeWTrackerMessages<T extends Message | ChatMessage>(messages: T[], settings: ExtensionSettings): T[] {
  const copyMessages = structuredClone(messages);
  if (settings.includeLastXWTrackerMessages <= 0) {
    return copyMessages;
  }

  for (let i = 0; i < settings.includeLastXWTrackerMessages; i++) {
    let foundMessage: T | null = null;
    let foundIndex = -1;

    for (let j = copyMessages.length - 2; j >= 0; j--) {
      const message = copyMessages[j];
      const sourceMessage = 'source' in message ? (message as Message).source : (message as ChatMessage);
      const tracker = getTrackerForActiveSwipe(sourceMessage);
      // @ts-ignore
      if (!message.wTrackerFound && tracker?.value) {
        // @ts-ignore
        message.wTrackerFound = true;
        foundMessage = message;
        foundIndex = j;
        break;
      }
    }

    if (!foundMessage) {
      continue;
    }

    const sourceMessage = 'source' in foundMessage ? (foundMessage as Message).source : (foundMessage as ChatMessage);
    const tracker = getTrackerForActiveSwipe(sourceMessage);
    const content = `Tracker:\n\`\`\`json\n${JSON.stringify(tracker?.value || '{}', null, 2)}\n\`\`\``;

    copyMessages.splice(
      foundIndex + 1,
      0,
      {
        content,
        role: 'user',
        name: name1,
        is_user: true,
        mes: content,
        is_system: false,
      } as unknown as T,
    );
  }

  return copyMessages;
}

async function deleteTracker(messageId: number) {
  const message = globalContext.chat[messageId];
  if (!getTrackerForActiveSwipe(message)) return;

  const confirm = await globalContext.Popup.show.confirm(
    'Delete Tracker',
    'Are you sure you want to delete the tracker data for this swipe? This cannot be undone.',
  );

  if (confirm) {
    deleteTrackerForActiveSwipe(message);
    await globalContext.saveChat();
    renderTracker(messageId);
    st_echo('success', 'Tracker data deleted for this swipe.');
  }
}

async function editTracker(messageId: number) {
  const message = globalContext.chat[messageId];
  const tracker = getTrackerForActiveSwipe(message);
  if (!tracker?.value) return;

  const currentData = tracker.value;

  const popupContent = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <label for="wtracker-edit-textarea">Edit Tracker JSON:</label>
            <textarea id="wtracker-edit-textarea" class="text_pole" rows="15" style="width: 100%; resize: vertical;"></textarea>
        </div>
    `;

  globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, 'Edit Tracker', {
    okButton: 'Save',
    onClose: async (popup) => {
      if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
        const textarea = popup.content.querySelector('#wtracker-edit-textarea') as HTMLTextAreaElement;
        if (textarea) {
          try {
            const newData = JSON.parse(textarea.value);
            setTrackerForActiveSwipe(message, { value: newData, html: tracker.html });
            await globalContext.saveChat();
            let detailsState: boolean[] = [];
            const messageBlock = document.querySelector(`.mes[mesid="${messageId}"]`);
            const existingTracker = messageBlock?.querySelector('.mes_wtracker');

            if (existingTracker) {
              const detailsElements = existingTracker.querySelectorAll('details');
              detailsState = Array.from(detailsElements).map(
                (detail) => (detail as HTMLDetailsElement).open,
              );
            }
            renderTracker(messageId);
            if (detailsState.length > 0) {
              const newTracker = messageBlock?.querySelector('.mes_wtracker');
              if (newTracker) {
                const newDetailsElements = newTracker.querySelectorAll('details');
                newDetailsElements.forEach((detail, index) => {
                  if (detailsState[index] !== undefined) {
                    (detail as HTMLDetailsElement).open = detailsState[index];
                  }
                });
              }
            }
            st_echo('success', 'Tracker data updated.');
          } catch (e) {
            console.error('Error parsing new tracker data:', e);
            st_echo('error', 'Invalid JSON. Changes were not saved.');
          }
        }
      }
    },
  });
  const textarea = document.querySelector('#wtracker-edit-textarea') as HTMLTextAreaElement;
  if (textarea) {
    textarea.value = JSON.stringify(currentData, null, 2);
  }
}

function buildPromptForMode(
  baseMessages: Message[],
  settings: ExtensionSettings,
  mode: PromptEngineeringMode,
  chatJsonValue: object,
): { messages: Message[]; overridePayload?: Record<string, any> } {
  const messages = structuredClone(baseMessages);
  const promptRole = settings.promptRole ?? 'user';

  if (mode === PromptEngineeringMode.NATIVE) {
    messages.push({ content: settings.prompt, role: promptRole });
    return {
      messages,
      overridePayload: {
        json_schema: { name: 'SceneTracker', strict: true, value: chatJsonValue },
      },
    };
  }

  const format = mode as 'json' | 'xml';
  const promptTemplate = format === 'json' ? settings.promptJson : settings.promptXml;
  const exampleResponse = schemaToExample(chatJsonValue, format);
  const finalPrompt = Handlebars.compile(promptTemplate, { noEscape: true, strict: true })({
    schema: JSON.stringify(chatJsonValue, null, 2),
    example_response: exampleResponse,
  });
  messages.push({ content: finalPrompt, role: promptRole });
  return { messages };
}

function buildDirectOpenAIBaseMessages(id: number, settings: ExtensionSettings): Message[] {
  const start = settings.includeLastXMessages > 0 ? Math.max(0, id - settings.includeLastXMessages) : 0;
  return includeWTrackerMessages(globalContext.chat.slice(start, id + 1) as any, settings) as Message[];
}

function toOpenAIMessages(requestMessages: Message[]): Array<{ role: string; content: string }> {
  return requestMessages
    .map((message: any) => ({
      role: (message.role ?? (message.is_user ? 'user' : 'assistant') ?? 'user') as string,
      content: normalizeOpenAIMessageContent(message.content ?? message.mes),
    }))
    .filter((message) => message.content.trim().length > 0);
}

async function sendViaOpenAICompatible(
  settings: ExtensionSettings,
  requestMessages: Message[],
  signal: AbortSignal,
): Promise<string> {
  if (!settings.openaiUrl?.trim()) {
    throw Object.assign(new Error('OpenAI Compatible URL is not configured. Please set it in settings.'), {
      retryable: false,
    });
  }
  if (!settings.openaiModel?.trim()) {
    throw Object.assign(new Error('OpenAI Compatible model is not set. Please enter one in settings.'), {
      retryable: false,
    });
  }

  const endpoint = buildOpenAIChatCompletionsUrl(settings.openaiUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (settings.openaiKey?.trim()) {
    headers.Authorization = `Bearer ${settings.openaiKey.trim()}`;
  }

  const body: Record<string, any> = {
    model: settings.openaiModel.trim(),
    messages: toOpenAIMessages(requestMessages),
    temperature: 0.8,
    stream: true,
  };
  if (settings.openaiMaxTokens > 0) {
    body.max_tokens = settings.openaiMaxTokens;
  }

  const fetchWithMaybeProxy = async (url: string): Promise<Response> => {
    const useProxy = isLocalOpenAIEndpoint(url) && globalContext?.getRequestHeaders;
    if (useProxy) {
      try {
        return await fetch(`/proxy/${url}`, {
          method: 'POST',
          headers: { ...globalContext.getRequestHeaders(), ...headers },
          body: JSON.stringify(body),
          signal,
        });
      } catch (proxyError: any) {
        console.warn('[WTracker] OpenAI proxy failed, trying direct:', proxyError?.message || proxyError);
      }
    }

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  };

  let response: Response;
  try {
    response = await fetchWithMaybeProxy(endpoint);
  } catch (error: any) {
    throw Object.assign(new Error(`OpenAI Compatible request failed: ${error?.message || String(error)}`), {
      retryable: true,
    });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(`OpenAI Compatible auth failed (${response.status}): ${errorText}`), {
        retryable: false,
        status: response.status,
      });
    }
    throw Object.assign(new Error(`OpenAI Compatible request failed (${response.status}): ${errorText}`), {
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (!text.trim()) {
      throw Object.assign(new Error('OpenAI Compatible endpoint returned an empty response.'), {
        retryable: true,
      });
    }
    return text;
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {
          // skip non-json chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullContent.trim()) {
    throw Object.assign(new Error('OpenAI Compatible endpoint returned an empty response.'), {
      retryable: true,
    });
  }

  return fullContent;
}

async function requestTrackerGeneration(
  id: number,
  settings: ExtensionSettings,
  requestMessages: Message[],
  overridePayload?: Record<string, any>,
): Promise<any> {
  const abortController = pendingRequests.get(id);
  if (!abortController) {
    throw new DOMException('Request aborted by user', 'AbortError');
  }

  if (settings.connectionSource === 'openai') {
    const text = await sendViaOpenAICompatible(settings, requestMessages, abortController.signal);
    return { content: text };
  }

  const result = await globalContext.ConnectionManagerRequestService.sendRequest(
    settings.profileId,
    requestMessages,
    settings.maxResponseToken,
    {
      stream: false,
      extractData: true,
      includePreset: true,
      includeInstruct: true,
      signal: abortController.signal,
    },
    overridePayload || {},
  );

  return result;
}

function parseTrackerResponse(result: any, mode: PromptEngineeringMode, chatJsonValue: object) {
  if (mode === PromptEngineeringMode.NATIVE) {
    return result?.content;
  }

  if (!result?.content) {
    throw new Error('No response content received.');
  }

  return parseResponse(result.content, mode as 'json' | 'xml', { schema: chatJsonValue });
}

async function generateTracker(id: number) {
  const message = globalContext.chat[id];
  if (!message) return st_echo('error', `Message with ID ${id} not found.`);

  if (pendingRequests.has(id)) {
    pendingRequests.get(id)?.abort();
    st_echo('info', 'Tracker generation cancelled.');
    return;
  }

  const settings = settingsManager.getSettings();
  if (settings.connectionSource === 'profile' && !settings.profileId) {
    return st_echo('error', 'Please select a connection profile in settings.');
  }
  if (settings.connectionSource === 'openai' && !settings.openaiUrl.trim()) {
    return st_echo('error', 'Please set an OpenAI Compatible endpoint in settings.');
  }
  const context = SillyTavern.getContext();
  const chatMetadata = context.chatMetadata;
  const { extensionSettings, CONNECT_API_MAP, saveChat } = globalContext;
  chatMetadata[EXTENSION_KEY] = chatMetadata[EXTENSION_KEY] || {};
  chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] =
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] || settings.schemaPreset;

  const chatJsonValue = settings.schemaPresets[settings.schemaPreset].value;
  const chatHtmlValue = settings.schemaPresets[settings.schemaPreset].html;

  const profile = extensionSettings.connectionManager?.profiles?.find((p) => p.id === settings.profileId);
  const apiMap = profile?.api ? CONNECT_API_MAP[profile.api] : null;
  let characterId = characters.findIndex((char: any) => char.avatar === message.original_avatar);
  characterId = characterId !== -1 ? characterId : undefined;

  const messageBlock = document.querySelector(`.mes[mesid="${id}"]`);
  const mainButton = messageBlock?.querySelector('.mes_wtracker_button');
  const regenerateButton = messageBlock?.querySelector('.wtracker-regenerate-button');

  let detailsState: boolean[] = [];
  const existingTracker = messageBlock?.querySelector('.mes_wtracker');
  if (existingTracker) {
    const detailsElements = existingTracker.querySelectorAll('details');
    detailsState = Array.from(detailsElements).map((detail) => (detail as HTMLDetailsElement).open);
  }

  const abortController = new AbortController();
  pendingRequests.set(id, abortController);

  try {
    mainButton?.classList.add('spinning');
    regenerateButton?.classList.add('spinning');

    const baseMessages =
      settings.connectionSource === 'openai'
        ? buildDirectOpenAIBaseMessages(id, settings)
        : includeWTrackerMessages(
            (
              await buildPrompt(apiMap?.selected!, {
                targetCharacterId: characterId,
                messageIndexesBetween: {
                  end: id,
                  start: settings.includeLastXMessages > 0 ? Math.max(0, id - settings.includeLastXMessages) : 0,
                },
                presetName: profile?.preset,
                contextName: profile?.context,
                instructName: profile?.instruct,
                syspromptName: profile?.sysprompt,
                includeNames: !!((globalContext as any).groupId),
              })
            ).result,
            settings,
          );
    const modeSequence = buildModeSequence(settings.promptEngineeringMode, settings.fallbackNativeToJson);

    const { value: response, modeUsed, attempts } = await runWithRetry(
      modeSequence,
      settings.retryCount,
      async (mode) => {
        const { messages, overridePayload } = buildPromptForMode(baseMessages, settings, mode, chatJsonValue);
        const result = await requestTrackerGeneration(id, settings, messages, overridePayload);
        const parsed = parseTrackerResponse(result, mode, chatJsonValue);
        if (!parsed || Object.keys(parsed as any).length === 0) {
          throw new Error('Empty response from WTracker.');
        }
        return parsed;
      },
    );

    if (modeUsed !== settings.promptEngineeringMode) {
      st_echo('info', `WTracker mode fell back to ${modeUsed.toUpperCase()} after ${attempts} attempt(s).`);
    }

    setTrackerForActiveSwipe(message, { value: response, html: chatHtmlValue });

    try {
      renderTracker(id);

      if (detailsState.length > 0) {
        const newTracker = messageBlock?.querySelector('.mes_wtracker');
        if (newTracker) {
          const newDetailsElements = newTracker.querySelectorAll('details');
          newDetailsElements.forEach((detail, index) => {
            if (detailsState[index] !== undefined) {
              detail.open = detailsState[index];
            }
          });
        }
      }

      await saveChat();
    } catch {
      deleteTrackerForActiveSwipe(message);
      renderTracker(id);
      throw new Error('Generated data failed to render with the current template. Not saved.');
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Error generating tracker:', error);
      st_echo('error', `Tracker generation failed: ${(error as Error).message}`);
    }
  } finally {
    pendingRequests.delete(id);
    mainButton?.classList.remove('spinning');
    regenerateButton?.classList.remove('spinning');
  }
}

// --- UI Initialization (Non-React parts) ---

async function initializeGlobalUI() {
  // Add WTracker icon to message buttons
  const wTrackerIcon = document.createElement('div');
  wTrackerIcon.title = 'WTracker';
  wTrackerIcon.className = 'mes_button mes_wtracker_button fa-solid fa-truck-moving interactable';
  wTrackerIcon.tabIndex = 0;
  document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(wTrackerIcon);

  // Add global click listener for various tracker-related buttons on messages
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const messageEl = target.closest('.mes');

    if (!messageEl) return;
    const messageId = Number(messageEl.getAttribute('mesid'));
    if (isNaN(messageId)) return;

    if (target.classList.contains('mes_wtracker_button')) {
      generateTracker(messageId);
    } else if (target.classList.contains('wtracker-edit-button')) {
      editTracker(messageId);
    } else if (target.classList.contains('wtracker-regenerate-button')) {
      generateTracker(messageId);
    } else if (target.classList.contains('wtracker-delete-button')) {
      deleteTracker(messageId);
    }
  });

  const extensionsMenu = document.querySelector('#extensionsMenu');
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'wtracker_menu_buttons';
  buttonContainer.className = 'extension_container';
  extensionsMenu?.appendChild(buttonContainer);
  const buttonHtml = await globalContext.renderExtensionTemplateAsync(
    `third-party/${extensionName}`,
    'templates/buttons',
  );
  buttonContainer.insertAdjacentHTML('beforeend', buttonHtml);
  extensionsMenu?.querySelector('#wtracker_modify_schema_preset')?.addEventListener('click', async () => {
    await modifyChatMetadata();
  });

  // Set up event listeners for auto-mode and swipe rendering
  const settings = settingsManager.getSettings();
  globalContext.eventSource.on(
    EventNames.CHARACTER_MESSAGE_RENDERED,
    (messageId: number, type?: string) =>
      incomingTypes.includes(settings.autoMode) && shouldAutoGenerateForRenderType(type) && generateTracker(messageId),
  );
  globalContext.eventSource.on(
    EventNames.USER_MESSAGE_RENDERED,
    (messageId: number, type?: string) =>
      outgoingTypes.includes(settings.autoMode) && shouldAutoGenerateForRenderType(type) && generateTracker(messageId),
  );
  globalContext.eventSource.on(EventNames.MESSAGE_SWIPED, (messageId: number) => {
    renderTracker(messageId);
  });

  const renderAllTrackers = () => {
    globalContext.chat.forEach((_, i) => {
      try {
        renderTracker(i);
      } catch (error) {
        console.error(`Error rendering WTracker on message ${i}, removing active swipe tracker:`, error);
        st_echo('error', 'A WTracker template failed to render. Removing tracker from the active swipe.');
        const message = globalContext.chat[i];
        if (getTrackerForActiveSwipe(message)) {
          deleteTrackerForActiveSwipe(message);
        }
      }
    });
  };

  setTimeout(renderAllTrackers, 0);

  // Register the global generation interceptor as a no-op.
  // WTracker renders and generates trackers after messages/swipes, so it doesn't
  // need to mutate the chat array during generation.
  (globalThis as any).wtrackerGenerateInterceptor = () => {};
}

async function modifyChatMetadata() {
  const settings = settingsManager.getSettings();
  const context = SillyTavern.getContext();
  const chatMetadata = context.chatMetadata;
  if (!chatMetadata[EXTENSION_KEY]) {
    chatMetadata[EXTENSION_KEY] = {};
  }
  if (!chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY]) {
    chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = 'default';
    context.saveMetadataDebounced();
  }
  const currentPresetKey = chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY];

  // Prepare data for the Handlebars template
  const templateData = {
    presets: Object.entries(settings.schemaPresets).map(([key, preset]) => ({
      key: key,
      name: preset.name,
      selected: key === currentPresetKey,
    })),
  };

  // Render the popup content from the template file
  const popupContent = await globalContext.renderExtensionTemplateAsync(
    'third-party/SillyTavern-WTracker',
    'templates/modify_schema_popup',
    templateData,
  );

  await globalContext.callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, '', {
    okButton: 'Save',
    onClose(popup) {
      if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
        const selectElement = document.getElementById('wtracker-chat-schema-select') as HTMLSelectElement;
        if (selectElement) {
          const newPresetKey = selectElement.value;
          if (newPresetKey !== currentPresetKey) {
            chatMetadata[EXTENSION_KEY][CHAT_METADATA_SCHEMA_PRESET_KEY] = newPresetKey;
            context.saveMetadataDebounced();
            st_echo('success', `Chat schema preset updated to "${settings.schemaPresets[newPresetKey].name}".`);
          }
        }
      }
    },
  });
}

// --- Main Application Entry ---

function renderReactSettings() {
  const settingsContainer = document.getElementById('extensions_settings');
  if (!settingsContainer) {
    console.error('WTracker: Extension settings container not found.');
    return;
  }

  let reactRootEl = document.getElementById('wtracker-react-settings-root');
  if (!reactRootEl) {
    reactRootEl = document.createElement('div');
    reactRootEl.id = 'wtracker-react-settings-root';
    settingsContainer.appendChild(reactRootEl);
  }

  const root = createRoot(reactRootEl);
  root.render(
    <React.StrictMode>
      <WTrackerSettings />
    </React.StrictMode>,
  );
}

function main() {
  renderReactSettings();
  initializeGlobalUI();
}

settingsManager
  .initializeSettings()
  .then(main)
  .catch((error) => {
    console.error(error);
    st_echo('error', 'WTracker data migration failed. Check console for details.');
  });
