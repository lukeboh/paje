import { execFile } from "node:child_process";

// PAJÉ's own GitHub OAuth App (Ov23li2sMJinkczX2RFj), registered with
// "Device Flow" enabled. A Client ID is not a secret — GitHub's own device
// flow docs embed it in client-side code — so it's safe to keep as a plain
// constant here instead of something that needs to be configured per user.
export const GITHUB_OAUTH_CLIENT_ID = "Ov23li2sMJinkczX2RFj";

// Matches what listGroups()/listUserProjects() need: read:org to list
// organizations (GET /user/orgs), repo to list and clone private repos too
// (GET /user/repos would otherwise only see public ones).
export const GITHUB_DEVICE_FLOW_SCOPE = "repo read:org";

export type GitHubDeviceCodeResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
};

export type RequestGitHubDeviceCodeOptions = {
  clientId?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
};

export const requestGitHubDeviceCode = async (
  options: RequestGitHubDeviceCodeOptions = {}
): Promise<GitHubDeviceCodeResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: options.clientId ?? GITHUB_OAUTH_CLIENT_ID,
    scope: options.scope ?? GITHUB_DEVICE_FLOW_SCOPE,
  });
  const response = await fetchImpl("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub device code request failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
};

// Distinguishes why polling stopped (denied/expired vs. a transport error)
// so the caller can show a message specific to each case.
export class GitHubDeviceFlowError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type PollGitHubDeviceAccessTokenOptions = {
  clientId?: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export const pollGitHubDeviceAccessToken = async (
  options: PollGitHubDeviceAccessTokenOptions
): Promise<{ token: string; scope: string }> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  let intervalMs = Math.max(options.intervalSeconds, 1) * 1000;
  const deadline = now() + options.expiresInSeconds * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    const body = new URLSearchParams({
      client_id: options.clientId ?? GITHUB_OAUTH_CLIENT_ID,
      device_code: options.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const response = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await response.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
      interval?: number;
    };
    if (data.access_token) {
      return { token: data.access_token, scope: data.scope ?? "" };
    }
    if (data.error === "authorization_pending") {
      continue;
    }
    if (data.error === "slow_down") {
      intervalMs = Math.max(data.interval ?? options.intervalSeconds + 5, 1) * 1000;
      continue;
    }
    throw new GitHubDeviceFlowError(
      data.error ?? "unknown_error",
      data.error_description ?? data.error ?? "GitHub device flow failed"
    );
  }
  throw new GitHubDeviceFlowError("expired_token", "Device code expired before authorization completed");
};

// Best-effort only: the code + URL are always shown to the user too, so a
// headless/remote session (or a platform this doesn't recognize) still has
// a way forward — it just means opening the link by hand.
export const openInBrowser = (url: string): void => {
  const platform = process.platform;
  if (platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], () => undefined);
    return;
  }
  const command = platform === "darwin" ? "open" : "xdg-open";
  execFile(command, [url], () => undefined);
};
