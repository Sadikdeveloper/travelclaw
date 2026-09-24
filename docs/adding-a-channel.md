# Add a channel

Channels enter through the gateway. They do not call the model themselves.

## Contract

Implement the shape exported as `ChannelPlugin` from `@travelclaw/shared`:

- `id` — stable string, used in the session key
- `label` — shown in the control UI
- `status` — `ready`, `disabled`, or `not_configured`
- `detail` — one sentence a contributor can act on

Inbound messages should call `GatewayService.handleIncoming` with that channel id and a stable `peerId`. Outbound delivery stays inside the adapter.

## Where to register

Add the plugin in `apps/api/src/channels/channels.service.ts`. Explicit registration is deliberate. Do not scan `extensions/` for executable code until the allowlist task in the roadmap exists.

## Credentials

Read tokens from the environment inside the adapter. Never commit them, and never write them into `workspace/` or SQLite.

## Session keys

Use `sessionKey({ agentId, channel, peerId })`. One direct traveler is one peer. A group is the room id, not the sender, or the desk will mix conversations.
