# Installed runtime contract (0.2.1-rc.3)

Authority: installed `C:/Users/yifan/AppData/Local/Programs/DeepSeek Harness/resources/app.asar`, under `dsh/node_modules/@deepseek-ai`. Investigation read package code only, never credentials or user session data.

## Host plugin

Use a plain ESM plugin `{ name, inject: ['sessionController', 'workspaceController', 'workspaceRegistry'], apply(ctx, config) { ... } }`. No runtime imports from DSH packages are necessary to call these injected objects. Default/named runtime exports are `SessionController` from `@deepseek-ai/dsh-api-session-controller`, `WorkspaceController` from `@deepseek-ai/dsh-api-workspace-controller`, `WorkspaceRegistry` from `@deepseek-ai/dsh-workspace`, and `SessionStore` from `@deepseek-ai/dsh-session`. Service constructor snippets: `super(ctx, "sessionController", { namespace: "session" })`, `super(ctx, "workspaceController", { namespace: "workspace" })`.

## Calls

- `ctx.workspaceRegistry.list()` synchronously lists registered workspace entities (`id`, `path`, `title`, `sessionIds`). For the controller wire shape use `ctx.workspaceController.follow(signal)`: async iterable; first frame `{type:'baseline', value:{items, archivedSessionIds, pinnedSessionIds}}`, then `replace/upsert/remove/order/archived/pinned` increments. Each wire item has `workspaceId,path,title,sessionIds,createdAt,updatedAt`.
- `await ctx.workspaceController.create({path})` returns `{workspace,created}`; idempotently registers an existing directory.
- `await ctx.sessionController.create({cwd?, workspaceId?, sessionId?, agentPreset?})` returns `{sessionId,agentPreset?}`. `workspaceId` and `cwd` are mutually exclusive. Workspace mode resolves its directory and attaches the created session; use workspaceId when available.
- `await ctx.sessionController.list({}, signal)` returns `{items: SessionSummary[]}` (not paginated despite optional cursor). Summary: `sessionId,updatedAt,running,blank,agentAvailable,cwd?,parentSessionId?,origin?,projections?,formatStatus?`.
- `ctx.sessionController.follow({address:{kind:'session',sessionId},maxMessages?:50,assistantStream:true}, signal)` returns an async iterable. First frame `{type:'snapshot',header,cursor,records,hasMore,projections,assistantStream?}`; subsequent frames `{type:'event',event}` and `{type:'assistant-stream',frame}`. Durable records are event records, not flattened UI messages. Abort the passed AbortController to unsubscribe. Optional assistant frames contain transient streaming deltas.
- `await ctx.sessionController.page({address:{kind:'session',sessionId},throughSeq,beforeSeq?,maxMessages?},signal)` returns `{records,hasMore}` in chronological order. throughSeq is the actual snapshot cursor obtained from follow; larger-than-current cursors are rejected. beforeSeq is exclusive for older-page fetches. `maxMessages` counts aligned messages; default 50.
- `await ctx.sessionController.prompt({requestId:crypto.randomUUID(),sessionId,mode:'queue',content:[{type:'text',text}],clientTimeZone?:'Asia/Shanghai'},signal)` returns `{accepted:true}`. `mode:'steer'` invokes agent.steer; queue invokes agent.followup. requestId supports duplicate suppression. The signal is caller cancellation BEFORE admission, not cancellation of the resulting turn.
- `ctx.sessionController.cancel({sessionId})` returns `{accepted:true}` and calls `agent.cancel({kind:'user'},{keepInbox:true})`.
- `ctx.sessionController.control(signal)` returns async baseline/replacement frames for session projections and running state.

Source: controller `lib/index.js`, exact type declarations also embedded as strings in `lib/typert.host.js`.

## Bundle and install

Package manifest needs `type:module`, export/default/main pointing to the plugin JS, and `dsh:{bundle:{patch:'./cordis.patch.yml'}}`. Publish/package must include patch and JS. Minimal YAML:

```yaml
- insert:
    - id: dsh-chrome-bridge
      name: dsh-chrome-bridge
      config:
        port: 19233
```

The row name resolves the installed package; it can be the same package as the bundle. Add appropriate exact runtime requirement `dsh.requires` only after checking the manifest schema; do not guess its shape.

Installed CLI syntax from `dsh/lib/bin.js`: `dsh plugin --profile desktop add <package-or-local-tgz>` (Desktop must be fully quit, and initialized at least once). Desktop's installed carrier explicitly permits reserved desktop profile management; generic npm dsh may reject that profile. Plugin command forwards add/install to pnpm and reconciles NEW bundle dependency manifests into `dsh.profile.bundles` automatically after validating patch files. Plain dependencies without dsh.bundle are not activated. No app.asar modification is needed.
