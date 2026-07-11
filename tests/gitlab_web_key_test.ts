import assert from "node:assert/strict";
import { GitLabApi } from "../src/modules/git/gitlabApi.js";

const makeHeaders = (extra?: Record<string, string>) =>
  new Map(
    Object.entries({
      "content-type": "text/html; charset=utf-8",
      ...(extra ?? {}),
    })
  );

class MockResponse {
  readonly headers: { get: (key: string) => string | null; getSetCookie?: () => string[] };
  constructor(
    private readonly body: string,
    readonly status: number,
    headerMap: Map<string, string>,
    setCookies?: string[]
  ) {
    this.headers = {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
      getSetCookie: setCookies ? () => setCookies : undefined,
    };
  }
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  async text(): Promise<string> {
    return this.body;
  }
  async json(): Promise<unknown> {
    return JSON.parse(this.body);
  }
}

const signInHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-signin" /></head>
  <body>
    <form>
      <input type="hidden" name="authenticity_token" value="token-signin" />
    </form>
  </body>
</html>
`;

const keysHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-keys" /></head>
  <body>
    <form>
      <input type="hidden" name="authenticity_token" value="token-keys" />
    </form>
  </body>
</html>
`;

const originalFetch = globalThis.fetch;

const calls: Array<{ url: string; init?: RequestInit }> = [];

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  calls.push({ url, init });
  if (url.endsWith("/users/sign_in")) {
    return new MockResponse(signInHtml, 200, makeHeaders(), ["_gitlab_session=abc; Path=/; HttpOnly"]) as unknown as Response;
  }
  if (url.endsWith("/users/auth/ldapmain/callback")) {
    return new MockResponse("", 302, makeHeaders({ location: "/" }), ["_gitlab_session=def; Path=/; HttpOnly"]) as unknown as Response;
  }
  if (url.endsWith("/-/user_settings/ssh_keys") && (!init?.method || init.method === "GET")) {
    return new MockResponse(keysHtml, 200, makeHeaders(), ["_gitlab_session=ghi; Path=/; HttpOnly"]) as unknown as Response;
  }
  if (url.endsWith("/-/user_settings/ssh_keys") && init?.method === "POST") {
    return new MockResponse("", 302, makeHeaders({ location: "/-/user_settings/ssh_keys/1722" })) as unknown as Response;
  }
  if (url.endsWith("/-/user_settings/ssh_keys/1722")) {
    return new MockResponse("<html><body>paje</body></html>", 200, makeHeaders()) as unknown as Response;
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const api = new GitLabApi({
  baseUrl: "https://git.tse.jus.br",
  basicAuth: { username: "usuario", password: "segredo" },
});

const result = await api.createSshKey("paje", "ssh-ed25519 AAA");

assert.ok(result.id > 0, "Deve retornar id da chave via redirecionamento");
assert.ok(
  calls.some((call) => call.url.endsWith("/users/auth/ldapmain/callback")),
  "Deve chamar endpoint de login LDAP"
);
assert.ok(
  calls.some((call) => call.url.endsWith("/-/user_settings/ssh_keys") && call.init?.method === "POST"),
  "Deve chamar cadastro de chave via web"
);

globalThis.fetch = originalFetch as typeof fetch;

console.log("gitlab_web_key_test: OK");
