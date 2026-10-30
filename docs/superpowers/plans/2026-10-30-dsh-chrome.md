# DSH Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build the approved dsh Chrome side panel with selection context, private default project, and reciprocal installation entry points.

**Architecture:** Package an ESM dsh bundle and its native host together with a Manifest V3 extension. Use authenticated per-user named-pipe IPC between native host and the loaded dsh plugin, with one versioned request protocol. The installed 0.2.1-rc.3 runtime is the integration authority.

**Tech Stack:** Node.js 22+, native Node test runner, plain browser JavaScript/CSS, Chrome Native Messaging, Windows per-user host registration.

## Global Constraints

- No modifications to app.asar, existing project files, credentials or session stores.
- User chooses one install entry. Prepare the counterpart automatically; retain required browser/OS installation confirmations.
- Hidden default directory is `$DSH_HOME/chrome/default-project`; do not register it in the ordinary workspace registry.
- Capture only explicitly added selection text, title and URL; submit context only when sending.
- Persist project-scoped drafts. Do not resend automatically after uncertain send outcomes.
- Source material is untrusted text; no arbitrary installer URLs or shell commands in messages.
- Never claim mock evidence as real browser/dsh integration evidence.

## Wire contract

Requests: `{protocolVersion:1,requestId:string,method:string,params:object}`.
Replies: `{protocolVersion:1,requestId:string,result:object}` or `{protocolVersion:1,requestId:string,error:{code,message}}`.
Events: `{protocolVersion:1,event:string,data:object}`.

Operations: `integration.status`, `integration.handshake`, `projects.list`, `sessions.list({projectId})`, `sessions.create({projectId})`, `sessions.read({sessionId})`, `messages.send({sessionId,messageId,text,contexts})`, `messages.status({sessionId,messageId})`, `sessions.cancel({sessionId})`, `installation.ensureCompanion({target})`, `installation.openEntry({target})`.
Default project ID is `default`. Project rows `{id,title,path,isDefault}`. Session rows `{id,title,projectId}`. Read result `{session,messages:[{id,role,text}],running:boolean}`. Send acknowledgement `{messageId,status:'accepted'}`. Status result `{messageId,status:'accepted'|'unknown'}`. Events `session.changed` `{sessionId}` cause a debounced authoritative refresh. `installation.progress` includes operationId, stage, userAction and error. Selection limit 20000 characters, maximum 20 contexts per draft.

### Task 1: Real runtime compatibility and shared boundaries

Files: `docs/runtime-contract.md`, `package.json`, `shared/protocol.js`, `tests/protocol.test.js`.
- [ ] Read installed runtime exports and document exact supported service calls and installation command.
- [ ] Write protocol tests first. Example: `assert.throws(() => validateRequest({protocolVersion:99,requestId:'a',method:'projects.list',params:{}}))` and reject oversized/malformed messages and unknown methods.
- [ ] Run `node --test tests/protocol.test.js`, observe feature-missing failure, implement `validateRequest(value)` and `success(requestId,result)` / `failure(requestId,error)`, then verify pass.

### Task 2: dsh host and project/session behavior

Files: `host/index.js`, `host/service.js`, `host/runtime-adapter.js`, `cordis.patch.yml`, `tests/host.test.js`.
Interfaces: consume shared request protocol; produce `createService({adapter,stateDirectory})` with `handle(request)` and `subscribe(listener)` plus `close()`.
- [ ] Write tests for default directory idempotence, project membership rejection, persisted send IDs, and project-filtered session history.
- [ ] Run tests before implementation, implement host using verified public runtime services only, rerun.
- [ ] Expose authenticated per-user IPC with a discovery record. Dispose sockets, subscriptions and discovery on plugin unload.

### Task 3: Chrome side panel and explicit selection context

Files: `extension/manifest.json`, `extension/background.js`, `extension/sidepanel.html`, `extension/sidepanel.js`, `extension/styles.css`, `extension/drafts.js`, `tests/drafts.test.js`.
Interfaces: side panel sends `{type:'rpc',method,params}` through runtime messaging; background replies `{result}` or `{error:{message}}`, broadcasts `{type:'host-event',event,data}` and `{type:'draft-changed'}`. Draft storage `{selectedProjectId:'default',drafts:{[projectId]:{text,contexts,sessionId}}}` under `chrome.storage.local` key `dshChromeState`. Background owns mutations and native connection.
- [ ] Test project draft isolation, selection validation, duplicate handling and send snapshot clearing before implementation.
- [ ] Implement native side panel, connection/install state, project/session selection, history, send, stop, reference cards and current selection button.
- [ ] Background enqueues right-click selection durably before opening side panel. Use textContent for all external text.
- [ ] Run focused tests and syntax-check all browser modules.

### Task 4: Native host and reciprocal installer

Files: `native/main.js`, `native/framing.js`, `install/cli.js`, `install/coordinator.js`, `release.json`, `tests/native.test.js`, `tests/install.test.js`.
Interfaces: native host consumes Chrome little-endian length-prefixed JSON and connects to discovered authenticated pipe; coordinator exports status and ensure methods returning `ready|awaiting-user|installing|failed`. Release metadata has explicit nullable webStoreUrl, installerUrl and extensionId; unset production links produce truthful development instructions.
- [ ] Test split framing, maximum lengths, idempotent install decisions, missing native-host bootstrap and incompatible versions first.
- [ ] Implement pipe relay and current-user native host registration with stable allowlisted extension ID. Install command is explicit, never a package postinstall.
- [ ] Provide package tarball installation command and development extension loading instructions. Do not claim browser extension is installed until handshake.
- [ ] Run tests; prepare packaged artifacts with `npm pack --dry-run` then `npm pack`.

### Task 5: Integration, review and verification

Files: `README.md`, `scripts/check.mjs`, `tests/integration.test.js`, `docs/verification.md`.
- [ ] Test end-to-end native protocol over real local IPC against deterministic host adapter, including reconnection and error boundaries.
- [ ] Run `npm test`, `npm run check`, packaging validation and inspect artifacts.
- [ ] Request code review of host trust boundaries, selected text preservation and installer behavior; fix significant findings and rerun affected tests.
- [ ] Validate installed runtime loading through dsh's supported mechanism, then use Chrome to load and exercise the extension when available. Report any real installation/interaction steps still requiring the user.

## Progress

- Plan reviewed against the approved design. Work is on `feat/dsh-chrome` in the newly initialized project; no existing implementation or passing baseline tests existed.
- Git commit identity is not configured; no fabricated author identity will be supplied.
