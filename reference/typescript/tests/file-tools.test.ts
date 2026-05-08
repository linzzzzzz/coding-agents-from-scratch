import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import { executeTool } from "../src/agent/executeTool.ts";

describe("file tools (integration)", () => {
  const testDir = ".agent-test";

  afterEach(async () => {
    // Clean up test files
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("writeFile creates parent directories", async () => {
    const filePath = `${testDir}/deep/nested/file.txt`;
    const result = await executeTool("writeFile", {
      path: filePath,
      content: "hello",
    });

    expect(result).toContain("Successfully wrote");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("hello");
  });

  it("readFile returns error for missing file", async () => {
    const result = await executeTool("readFile", {
      path: `${testDir}/missing.txt`,
    });
    expect(result).toContain("File not found");
  });

  it("runCommand captures stderr", async () => {
    const result = await executeTool("runCommand", {
      command: "ls /nonexistent 2>&1",
    });
    expect(result).toContain("No such file");
  });
});
