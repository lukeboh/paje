import type { GitLabGroup, GitLabProject } from "./types.js";

export type GitHubApiOptions = {
  baseUrl: string;
  token: string;
  verbose?: boolean;
  logger?: (message: string) => void;
};

type GitHubUser = {
  id: number;
  login: string;
};

type GitHubOrg = {
  id: number;
  login: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string; id: number };
  ssh_url: string;
  clone_url: string;
  default_branch: string;
  archived: boolean;
  visibility?: "public" | "private" | "internal";
};

export class GitHubApi {
  private readonly serverUrl: string;
  private readonly apiBase: string;
  private readonly token: string;
  private readonly verbose: boolean;
  private readonly logger?: (message: string) => void;

  constructor(options: GitHubApiOptions) {
    this.serverUrl = options.baseUrl.replace(/\/$/, "");
    this.apiBase = this.resolveApiBase(this.serverUrl);
    this.token = options.token;
    this.verbose = options.verbose ?? false;
    this.logger = options.logger;
  }

  private resolveApiBase(baseUrl: string): string {
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      if (host === "github.com" || host === "www.github.com") {
        return "https://api.github.com";
      }
    } catch {
      // fallthrough
    }
    return `${baseUrl.replace(/\/$/, "")}/api/v3`;
  }

  getServerHost(): string {
    return new URL(this.serverUrl).hostname;
  }

  hasAuth(): boolean {
    return Boolean(this.token);
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "paje-cli/1.0",
    };
  }

  private logVerbose(message: string): void {
    if (!this.verbose) return;
    if (this.logger) {
      this.logger(message);
    } else {
      console.log(message);
    }
  }

  private parseLinkNext(link: string | null): string | null {
    if (!link) return null;
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }

  private async fetchJson<T>(url: string): Promise<{ data: T; headers: Headers }> {
    this.logVerbose(`HTTP GET ${url}`);
    const response = await fetch(url, { headers: this.buildHeaders() });
    this.logVerbose(`HTTP ${response.status} ${url}`);
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`GitHub API ${response.status}: ${text}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return { data: (await response.json()) as T, headers: response.headers };
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = `${this.apiBase}${path}`;
    while (nextUrl) {
      const { data, headers } = await this.fetchJson<T[]>(nextUrl);
      results.push(...data);
      nextUrl = this.parseLinkNext(headers.get("link"));
    }
    return results;
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const { data } = await this.fetchJson<GitHubUser>(`${this.apiBase}/user`);
    return data;
  }

  async listGroups(): Promise<GitLabGroup[]> {
    const [user, orgs] = await Promise.all([
      this.getAuthenticatedUser(),
      this.paginate<GitHubOrg>("/user/orgs"),
    ]);
    const userGroup: GitLabGroup = {
      id: user.id,
      name: user.login,
      full_path: user.login,
      parent_id: null,
    };
    const orgGroups: GitLabGroup[] = orgs.map((org) => ({
      id: org.id,
      name: org.login,
      full_path: org.login,
      parent_id: null,
    }));
    return [userGroup, ...orgGroups];
  }

  async listUserProjects(): Promise<GitLabProject[]> {
    const repos = await this.paginate<GitHubRepo>(
      "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100"
    );
    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      path_with_namespace: repo.full_name,
      ssh_url_to_repo: repo.ssh_url,
      http_url_to_repo: repo.clone_url,
      default_branch: repo.default_branch ?? "main",
      visibility: repo.private ? "private" : ((repo.visibility ?? "public") as "public" | "internal" | "private"),
      archived: repo.archived ?? false,
      namespace: {
        id: repo.owner?.id ?? 0,
        full_path: repo.owner?.login ?? "",
      },
    }));
  }

  async createSshKey(title: string, key: string): Promise<{ id: number }> {
    const url = `${this.apiBase}/user/keys`;
    this.logVerbose(`HTTP POST ${url}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.buildHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, key }),
    });
    this.logVerbose(`HTTP ${response.status} ${url}`);
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`GitHub API ${response.status}: ${text}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const data = (await response.json()) as { id: number };
    return { id: data.id };
  }
}
