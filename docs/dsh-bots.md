# Local DS Bot integration

Open `/dsh` or choose **Bots** for the native Ovis workspace. This fork offers a Bots directory and direct conversations from the sidebar. DSH owns chat,
execution, memory and approvals. A Bot appears once even when it works in several groups
or continues a conversation in a new session part. The view refreshes every five seconds
while open; disconnected results are explicitly stale and have unknown activity.

## Setup

Run the DS Bot fork's `feat/ovis-controls` branch and the Herdr plugin fork's
`feat/bot-controls` branch in the same DSH Web profile. The former supplies the
`botDirectory` Cordis service; the latter serves its metadata at `GET /herdr-bots`.
An older DS Bot remains usable, but the directory reports that its source is unavailable.

Set `OVIS_DSH_URL=http://127.0.0.1:<DSH-port>` on the Ovis server and restart Ovis.
Only HTTP loopback IP destinations are accepted; redirects, credentials, paths,
query strings and fragments are refused. Ovis does not forward browser cookies or tokens
to DSH. Its existing authentication protects `/api/bots`.

If DSH has an address reachable from another device, set `OVIS_DSH_PUBLIC_URL` to its
HTTP(S) origin. This is used only for the Open in DSH link; the fetch still stays local.
DSH's own login remains necessary. Without that setting a remote browser is told to open
DSH on the host, rather than being sent to the phone's localhost.

## Contract

`GET /api/bots` returns version 1, `machineId: "local"`, `runtimeId`, `observedAt`,
`state` (`online`, `offline`, `incompatible`, or `not_configured`), `openUrl`, and `bots`.
Each Bot has `id`, `name`, `role`, `status`, and `conversations`. Conversation entries
contain an ID, kind, name, current session ID, and the ordered session IDs of its parts.
Use `(machineId, runtimeId, bot.id)` as the identity, never a display name or pane ID.
Group conversation IDs repeat under their member Bots by design.

The runtime ID is saved once in DS Bot's home as `directory-id`. Back it up with the team;
copying a team to an independent runtime should omit this file to mint a new identity.
No prompts, transcripts, tool arguments, secrets, approval contents, or filesystem paths
are included in the directory. Responses are not cached by browsers. Ovis keeps only its last snapshot in
memory and marks its activity unknown on source failure. Reading the directory never
starts work or answers approvals. The Open in DSH link opens the team UI, not an individual conversation.

Remote DSH discovery, group messaging, approval controls and task links are later work.

## Design

The roster follows Conductor's status-oriented workspace navigation
(https://www.conductor.build/changelog/page/9), adapted to persistent Bot identities.
It uses Ovis's existing colors, modal focus handling and sidebar structure. No code or
assets were copied. Home and Boards remain owned by herdr-projects; their hash routes,
deep links, HTML injection and sidebar-footer hooks are unchanged.


## Direct conversations

The personal fork now supports text history, queued messages and streamed replies
inside the Bots view. Earlier history follows DS Bot session parts. Select a Bot,
read its own chat, and use Send message. A Bot still waiting for its initial model
selection shows a model picker above the conversation and keeps Send disabled until configured. Drafts stay in this browser tab across Bot
switches and leaving the workspace; reloading the page clears them. Group chats,
attachments, rich cards and approvals remain in DSH. Message text is rendered as
plain text, without executing HTML or loading remote images.

Create a random 32-byte hex credential in `~/.config/ovis-dsh/bridge-token` with
mode 0600, in a directory with mode 0700. Both servers read it on startup; alternatively
set `HERDR_DSH_TOKEN_FILE` to a private file in each server environment. Keep
`OVIS_DSH_URL` set to the local DSH origin. Never put this credential in a URL,
browser storage or git. Without it the directory works but chat is disabled.

Chat endpoints `/api/bots/chat`, `/api/bots/send`, `/api/bots/events` require full
Ovis access; watch-only devices cannot read this history or send. Sending additionally
requires the same-origin check and `x-ovis-bot: 1`. Ovis sends only its own bridge
credential to the fixed loopback origin, never browser credentials. Device revocation
closes its active stream. DSH routes are `/herdr-bots/chat`, `/herdr-bots/send`, and
`/herdr-bots/events`. They require a matching Bearer credential and local Host/Origin.

The stream refreshes history on reconnect, rather than replaying partial deltas.
Sends use a client request ID, bounded runtime deduplication, and no automatic retry.
An uncertain acknowledgement leaves the draft visible. Check history before sending
again. Deduplication is not promised across a DSH restart.

Design reference: [Conductor](https://www.conductor.build/changelog) separates the
agent list from the active conversation and keeps follow-up messages in the composer.
This view follows that arrangement using Ovis's existing modal, theme and controls.

## Native model and stop controls

`GET /api/bots/settings` returns bounded model metadata and the current direct
session. `POST /api/bots/control` accepts only `model` or `stop`, a runtime/Bot
identity and a request ID. Both require full Ovis access; writes also require the
same-origin and `x-ovis-bot` checks used for sending. The Node plugin exposes
the corresponding authenticated `/herdr-bots/settings` and `/herdr-bots/control`
routes. No DSH cookie, browser token, or iframe participates in this native view.

Choosing the initial model starts DS Bot's normal welcome reply. Stop cancels
only the displayed direct session and refuses a session that rotated. It does
not stop group work, delete queued messages, or answer approvals. On an uncertain
response the UI refreshes state and asks the user to check it before trying again.
Model and stop controls require the updated plugins; older plugins can still
serve chat while controls show as unavailable.

The `/dsh` route survives reload, preserves selected Bot identity in its URL, and
supports browser Back/Forward. Home and Boards can open over it. Selecting a
terminal returns to the ordinary Ovis pane view. The original DSH entry still
uses DSH's separate login for advanced features.


## Verification

`bun run check run --build bun scripts/bots-browser-qa.ts` covers fictional chat,
streaming, offline recovery, drafts and desktop/phone layouts.
`bun run check run bun test server/bots.contract.test.ts` checks browser authorization.
For a DS Bot mock bench after its smoke suite, set `BOT_CHAT_TEST_HOME` to its
`.dsh-test-<name>` directory and `BOT_CHAT_TEST_PORT` to its non-3080 port, then run
`bun run check run bun scripts/bot-chat-dsh-qa.ts`. The script checks the directory
identity against that disposable home before sending a mock prompt.


## Embedded DSH workspace

Open DSH in the Ovis sidebar opens the full DSH UI in an isolated iframe. It uses
the DSH browser login, so models, group chats, approvals and other DSH features stay
owned by DSH. If its login gate appears, open the startup login link printed by DSH,
then use Reload DSH. Ovis never reads or forwards the login token. Closing the view
closes only the frame, not the running DSH service. Escape inside DSH belongs to
DSH's own dialogs; the outer Close DSH button is always available.

The frame uses the directory's configured DSH public address and Ovis's existing
same-host frame policy. On another device, configure a reachable DSH address under
the same hostname and a different port; HTTPS Ovis requires HTTPS DSH. It never
redirects a phone to its own localhost or proxies DSH into Ovis's origin. The portal
launcher is hidden for Ovis watch-only devices; DSH separately enforces its own login.
