import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseRemoteRepository, repositoryIdFor } from "./code-repos.service";

describe("parseRemoteRepository", () => {
  describe("GitHub", () => {
    it("parses HTTPS clone URL with .git suffix", () => {
      const parsed = parseRemoteRepository("https://github.com/anthropics/claude-code.git");
      expect(parsed.provider).toBe("github");
      expect(parsed.host).toBe("github.com");
      expect(parsed.owner).toBe("anthropics");
      expect(parsed.repo).toBe("claude-code");
      expect(parsed.projectPath).toBe("anthropics/claude-code");
      expect(parsed.cloneUrl).toBe("https://github.com/anthropics/claude-code.git");
      expect(parsed.apiBaseUrl).toBe("https://api.github.com");
    });

    it("parses HTTPS URL without .git suffix", () => {
      const parsed = parseRemoteRepository("https://github.com/anthropics/claude-code");
      expect(parsed.repo).toBe("claude-code");
      expect(parsed.cloneUrl).toBe("https://github.com/anthropics/claude-code.git");
    });

    it("parses SSH clone URL", () => {
      const parsed = parseRemoteRepository("git@github.com:anthropics/claude-code.git");
      expect(parsed.provider).toBe("github");
      expect(parsed.host).toBe("github.com");
      expect(parsed.owner).toBe("anthropics");
      expect(parsed.repo).toBe("claude-code");
    });

    it("strips repository sub-paths like /tree/main and /blob/...", () => {
      expect(parseRemoteRepository("https://github.com/anthropics/claude-code/tree/main").repo).toBe("claude-code");
      expect(parseRemoteRepository("https://github.com/anthropics/claude-code/blob/main/README.md").repo).toBe(
        "claude-code",
      );
      expect(parseRemoteRepository("https://github.com/anthropics/claude-code/releases/tag/v1.0").repo).toBe(
        "claude-code",
      );
    });
  });

  describe("GitLab", () => {
    it("parses self-hosted GitLab URL with nested namespace", () => {
      const parsed = parseRemoteRepository("https://gitlab.example.com/group/sub/project.git");
      expect(parsed.provider).toBe("gitlab");
      expect(parsed.host).toBe("gitlab.example.com");
      expect(parsed.owner).toBe("group/sub");
      expect(parsed.repo).toBe("project");
      expect(parsed.projectPath).toBe("group/sub/project");
      expect(parsed.apiBaseUrl).toBe("https://gitlab.example.com/api/v4");
    });

    it("parses gitlab.com SSH URL", () => {
      const parsed = parseRemoteRepository("git@gitlab.com:group/project.git");
      expect(parsed.provider).toBe("gitlab");
      expect(parsed.owner).toBe("group");
      expect(parsed.repo).toBe("project");
    });
  });

  describe("GitCode", () => {
    it("parses GitCode HTTPS URL", () => {
      const parsed = parseRemoteRepository("https://gitcode.com/owner/repo.git");
      expect(parsed.provider).toBe("gitcode");
      expect(parsed.host).toBe("gitcode.com");
      expect(parsed.apiBaseUrl).toBe("https://api.gitcode.com/api/v5");
    });

    it("normalizes the api.gitcode.com host into clone-friendly gitcode.com", () => {
      const parsed = parseRemoteRepository("https://api.gitcode.com/api/v5/repos/owner/repo");
      expect(parsed.host).toBe("gitcode.com");
      expect(parsed.owner).toBe("owner");
      expect(parsed.repo).toBe("repo");
      expect(parsed.cloneUrl).toBe("https://gitcode.com/owner/repo.git");
    });
  });

  describe("explicit provider override", () => {
    it("respects explicit provider even when host matches another", () => {
      const parsed = parseRemoteRepository("https://github.com/owner/repo.git", "gitea");
      expect(parsed.provider).toBe("gitea");
    });
  });

  describe("error cases", () => {
    it("rejects URL without owner/repo path", () => {
      expect(() => parseRemoteRepository("https://github.com/")).toThrow(BadRequestException);
    });

    it("rejects malformed URL", () => {
      expect(() => parseRemoteRepository("not-a-url")).toThrow(BadRequestException);
    });
  });
});

describe("repositoryIdFor", () => {
  it("formats provider:projectPath", () => {
    const parsed = parseRemoteRepository("https://github.com/anthropics/claude-code");
    expect(repositoryIdFor(parsed)).toBe("github:anthropics/claude-code");
  });

  it("preserves nested namespace in id", () => {
    const parsed = parseRemoteRepository("https://gitlab.example.com/group/sub/project.git");
    expect(repositoryIdFor(parsed)).toBe("gitlab:group/sub/project");
  });
});
