import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findLatestCodexSession } from "../agents/codex.js";

async function writeSession(sessionsRoot, date, name, payload, { mtime } = {}) {
  const [year, month, day] = date.split("-");
  const dir = join(sessionsRoot, year, month, day);
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(
    file,
    JSON.stringify({ type: "session_meta", payload }) + "\n" +
      JSON.stringify({ type: "event_msg", payload: { msg: "ignored" } }) + "\n",
  );
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

async function writeMalformedSession(sessionsRoot, date, name, { mtime } = {}) {
  const [year, month, day] = date.split("-");
  const dir = join(sessionsRoot, year, month, day);
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, "{not json}\n");
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

test("findLatestCodexSession returns the newest interactive cwd match using payload id", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeSession(
    sessionsRoot,
    "2026-05-26",
    "rollout-2026-05-26T10-00-00-old.jsonl",
    { id: "payload-old", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-26T10:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T12-00-00-other-project.jsonl",
    { id: "payload-other", cwd: join(tmp, "projects", "other"), originator: "codex-tui" },
    { mtime: new Date("2026-05-27T12:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T11-00-00-new.jsonl",
    { id: "payload-new", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-27T11:00:00Z") },
  );

  const latest = await findLatestCodexSession("ignored", { sessionsRoot, projectPath });
  assert.equal(latest?.sessionId, "payload-new");
  assert.match(latest?.path ?? "", /rollout-2026-05-27T11-00-00-new\.jsonl$/);
});

test("findLatestCodexSession ignores non-interactive, malformed, and unusable-id sessions", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeMalformedSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T12-00-00-malformed.jsonl",
    { mtime: new Date("2026-05-27T12:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T12-45-00-unsafe-id.jsonl",
    { id: "--last", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-27T12:45:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T12-30-00-desktop.jsonl",
    { id: "payload-desktop", cwd: projectPath, originator: "Codex Desktop" },
    { mtime: new Date("2026-05-27T12:30:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T11-00-00-exec.jsonl",
    { id: "payload-exec", cwd: projectPath, originator: "codex-exec" },
    { mtime: new Date("2026-05-27T11:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-26",
    "rollout-2026-05-26T10-00-00-interactive.jsonl",
    { id: "payload-interactive", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-26T10:00:00Z") },
  );

  const latest = await findLatestCodexSession("ignored", { sessionsRoot, projectPath });
  assert.equal(latest?.sessionId, "payload-interactive");
});

test("findLatestCodexSession matches symlinked project cwd by realpath", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const realProjectPath = join(tmp, "real-projects", "p1");
  const linkRoot = join(tmp, "link-projects");
  const linkedProjectPath = join(linkRoot, "p1");
  await mkdir(realProjectPath, { recursive: true });
  await mkdir(linkRoot, { recursive: true });
  await symlink(realProjectPath, linkedProjectPath, "dir");

  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T10-00-00-realpath.jsonl",
    { id: "payload-realpath", cwd: realProjectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-27T10:00:00Z") },
  );

  const latest = await findLatestCodexSession("ignored", {
    sessionsRoot,
    projectPath: linkedProjectPath,
  });
  assert.equal(latest?.sessionId, "payload-realpath");
});

test("findLatestCodexSession respects the date-dir lookback cap", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T10-00-00-new-nonmatch.jsonl",
    { id: "payload-new-nonmatch", cwd: join(tmp, "projects", "other"), originator: "codex-tui" },
    { mtime: new Date("2026-05-27T10:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-26",
    "rollout-2026-05-26T10-00-00-old-match.jsonl",
    { id: "payload-old-match", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-26T10:00:00Z") },
  );

  assert.equal(
    await findLatestCodexSession("ignored", { sessionsRoot, projectPath, maxDateDirs: 1 }),
    null,
  );
  const latest = await findLatestCodexSession("ignored", {
    sessionsRoot,
    projectPath,
    maxDateDirs: 2,
  });
  assert.equal(latest?.sessionId, "payload-old-match");
});

test("findLatestCodexSession respects the file scan cap", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T12-00-00-new-nonmatch.jsonl",
    { id: "payload-new-nonmatch", cwd: join(tmp, "projects", "other"), originator: "codex-tui" },
    { mtime: new Date("2026-05-27T12:00:00Z") },
  );
  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T11-00-00-old-match.jsonl",
    { id: "payload-old-match", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-27T11:00:00Z") },
  );

  assert.equal(
    await findLatestCodexSession("ignored", { sessionsRoot, projectPath, maxFiles: 1 }),
    null,
  );
  const latest = await findLatestCodexSession("ignored", {
    sessionsRoot,
    projectPath,
    maxFiles: 2,
  });
  assert.equal(latest?.sessionId, "payload-old-match");
});

test("findLatestCodexSession returns null when the sessions root is missing", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  assert.equal(
    await findLatestCodexSession("ignored", {
      sessionsRoot: join(tmp, "missing", "sessions"),
      projectPath,
    }),
    null,
  );
});

// 🔴 Reproduces a real stuck project (2026-09-08, project_t5j9wy).
//
// Codex writes sub-agent rollouts into the same directory as the thread that
// spawned them, with the SAME cwd and the SAME originator — so every other
// filter here passes them. And a sub-agent is spawned after its parent, so
// under "newest wins" it always beats the thread the user is actually in.
//
// The consequence is not a wrong-but-usable id. Codex refuses outright:
// "cannot resume an unloaded multi-agent v2 sub-agent through its parent".
// The id then lands in meta.agent_session_id and is retried on every refresh,
// so one sub-agent leaves the project's terminal permanently unresumable with
// no way out from the UI.
//
// The field values below are transcribed from that real rollout.
test("findLatestCodexSession skips sub-agent rollouts and returns the parent thread", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeSession(
    sessionsRoot,
    "2026-09-08",
    "rollout-2026-09-08T18-15-20-parent.jsonl",
    { id: "01a0823b-parent", cwd: projectPath, originator: "codex-tui", thread_source: "user" },
    { mtime: new Date("2026-09-08T18:15:20Z") },
  );
  // Newer, same cwd, same originator — wins on every axis but this one.
  await writeSession(
    sessionsRoot,
    "2026-09-08",
    "rollout-2026-09-08T18-51-07-subagent.jsonl",
    {
      id: "01a0825c-subagent",
      cwd: projectPath,
      originator: "codex-tui",
      thread_source: "subagent",
      parent_thread_id: "01a0823b-parent",
      source: { subagent: { thread_spawn: { parent_thread_id: "01a0823b-parent", depth: 1 } } },
    },
    { mtime: new Date("2026-09-08T18:51:07Z") },
  );

  const latest = await findLatestCodexSession("ignored", { sessionsRoot, projectPath });
  assert.equal(
    latest?.sessionId,
    "01a0823b-parent",
    "picked the sub-agent — resuming it fails permanently and poisons meta.agent_session_id",
  );
});

test("findLatestCodexSession still accepts rollouts written before sub-agents existed", async (t) => {
  // Those carry no `thread_source` at all. Treating absence as "sub-agent"
  // would make every pre-multi-agent session unresumable — a bigger outage
  // than the bug being fixed.
  const tmp = await mkdtemp(join(tmpdir(), "codex-provider-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionsRoot = join(tmp, ".codex", "sessions");
  const projectPath = join(tmp, "projects", "p1");
  await mkdir(projectPath, { recursive: true });

  await writeSession(
    sessionsRoot,
    "2026-05-27",
    "rollout-2026-05-27T11-00-00-legacy.jsonl",
    { id: "legacy-no-thread-source", cwd: projectPath, originator: "codex-tui" },
    { mtime: new Date("2026-05-27T11:00:00Z") },
  );

  const latest = await findLatestCodexSession("ignored", { sessionsRoot, projectPath });
  assert.equal(latest?.sessionId, "legacy-no-thread-source");
});
