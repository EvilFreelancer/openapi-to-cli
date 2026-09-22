import fs from "fs";
import path from "path";

import yaml from "js-yaml";

interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, { if?: string; permissions?: Record<string, string> }>;
}

function loadWorkflow(fileName: string): Workflow {
  const workflowPath = path.join(__dirname, "..", ".github", "workflows", fileName);
  return yaml.load(fs.readFileSync(workflowPath, "utf-8")) as Workflow;
}

describe("GitHub Actions workflows", () => {
  it("runs the test suite for pull requests and pushes to main", () => {
    const workflow = loadWorkflow("tests-on-pr.yaml");

    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("push.branches", ["main"]);
  });

  it("creates version tags only from trusted main pushes", () => {
    const workflow = loadWorkflow("tag-on-merge.yaml");

    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("push.branches", ["main"]);
    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(workflow.jobs?.["tag-version"].if).toBeUndefined();
  });
});
