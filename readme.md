# SillyTavern WTracker

## Overview

A [SillyTavern](https://docs.sillytavern.app/) extension that helps you track your chat stats with LLMs using [connection profiles](https://docs.sillytavern.app/usage/core-concepts/connection-profiles/).

![popup](images/overview.png)

---

**You can edit the schema for active chat.**

![modify_for_this_chat](images/modify_for_this_chat.png)

---

![settings](images/settings.gif)

---

**If you are using a _Text Completion_ profile, make sure your profile contains API, preset, model, and instruct.**

**If you are using a _Chat Completion_ profile; API, settings, model would be enough.**

---

## Installation

Install via the SillyTavern extension installer:

```txt
https://github.com/mershant/SillyTavern-WTracker
```

## FAQ

> I'm having API error.

This repo now defaults to **Simple Generation (JSON)** instead of native structured output, which is more compatible with providers that only support ordinary generation.

If you still have issues:

- keep **Generation Mode** on `Simple Generation (JSON)`
- increase **Retry Attempts** if the model occasionally returns malformed output
- enable **Auto fallback from Native Structured Output to Simple JSON** if you want to keep native mode available but not brittle
- use `Simple Generation (XML)` only if your provider consistently formats XML better than JSON

> Why does native mode fail more often?

Native mode depends on provider/backend support for strict structured output. Many OpenAI-compatible providers reject or mishandle schema-enforced requests even when plain chat generation works fine.

> What is the difference compared to [famous tracker](https://github.com/kaldigo/SillyTavern-Tracker)?

Most importantly, it works. This is a minimalistic version of the original tracker.
- No annoying connection profile switch. (This is the reason why I created this extension in the first place.)
- No "Prompt Maker" option. Because JSON schema is easy enough to edit.
- No "Generation Target" option. (Could be added in the future)
- No "Generation Mode" option. Since this extension doesn't summarize the chat, no need for it. (I'm not planning to add a summarize feature.)
- There are some templates in the original, but I don't need them since I don't have those features.
