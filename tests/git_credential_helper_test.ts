import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCredentialTarget,
  ensureGitCredentialHelper,
  approveGitCredential,
  rejectGitCredential,
} from "../src/modules/git/gitCredentialHelper.js";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-cred-helper-test-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

try {
  // 1. parseCredentialTarget
  {
    const target1 = parseCredentialTarget("https://gitlab.example.com", "myuser");
    assert.equal(target1.protocol, "https");
    assert.equal(target1.host, "gitlab.example.com");
    assert.equal(target1.resolvedUsername, "myuser");

    const target2 = parseCredentialTarget("https://gitlab.example.com:8443");
    assert.equal(target2.protocol, "https");
    assert.equal(target2.host, "gitlab.example.com:8443");
    assert.equal(target2.resolvedUsername, "oauth2");

    const target3 = parseCredentialTarget("https://github.com");
    assert.equal(target3.protocol, "https");
    assert.equal(target3.host, "github.com");
    assert.equal(target3.resolvedUsername, "x-access-token");

    const target4 = parseCredentialTarget("https://git.corp.net", undefined, true);
    assert.equal(target4.protocol, "https");
    assert.equal(target4.host, "git.corp.net");
    assert.equal(target4.resolvedUsername, "x-access-token");
  }

  // 2. ensureGitCredentialHelper
  {
    await ensureGitCredentialHelper();
    // After calling, git config should have credential.helper = store in tmpHome
    const gitConfigFile = path.join(tmpHome, ".gitconfig");
    assert.ok(fs.existsSync(gitConfigFile), "Deve ter criado .gitconfig");
    const content = fs.readFileSync(gitConfigFile, "utf-8");
    assert.ok(content.includes("helper = store"), "Deve ter gravado credential.helper = store");
  }

  // 3. approveGitCredential
  {
    await approveGitCredential({
      baseUrl: "https://gitlab.example.com",
      token: "glpat-secret-token",
    });

    const gitCredentialsFile = path.join(tmpHome, ".git-credentials");
    assert.ok(fs.existsSync(gitCredentialsFile), "Deve ter criado .git-credentials");
    const credContent = fs.readFileSync(gitCredentialsFile, "utf-8");
    assert.ok(
      credContent.includes("https://oauth2:glpat-secret-token@gitlab.example.com"),
      "Deve ter gravado a credencial formatada no .git-credentials"
    );
  }

  // 4. rejectGitCredential
  {
    await rejectGitCredential({
      baseUrl: "https://gitlab.example.com",
    });

    const gitCredentialsFile = path.join(tmpHome, ".git-credentials");
    if (fs.existsSync(gitCredentialsFile)) {
      const credContent = fs.readFileSync(gitCredentialsFile, "utf-8");
      assert.ok(
        !credContent.includes("glpat-secret-token"),
        "Deve ter removido a credencial do .git-credentials após reject"
      );
    }
  }

  console.log("git_credential_helper_test: OK");
} finally {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {}
}
