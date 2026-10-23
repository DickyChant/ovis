# Local DS Bot directory

This fork offers a read-only Bots view from the sidebar. DSH continues to own chat,
execution, memory and approvals. A Bot appears once even when it works in several groups
or continues a conversation in a new session part. The view refreshes every five seconds
while open; disconnected results are explicitly stale and have unknown activity.

## Setup

Run the DS Bot fork's `feat/ovis-directory` branch and the Herdr plugin fork's
`fix/dsh-0.2-runtime` branch in the same DSH Web profile. The former supplies the
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
are included. Responses are not cached by browsers. Ovis keeps only its last snapshot in
memory and marks its activity unknown on source failure. No endpoint starts work or
answers approvals. The Open in DSH link opens the team UI, not an individual conversation.

Remote DSH discovery, messaging, approval controls and task links are later work.

## Design

The roster follows Conductor's status-oriented workspace navigation
(https://www.conductor.build/changelog/page/9), adapted to persistent Bot identities.
It uses Ovis's existing colors, modal focus handling and sidebar structure. No code or
assets were copied. Home and Boards remain owned by herdr-projects; their hash routes,
deep links, HTML injection and sidebar-footer hooks are unchanged.
