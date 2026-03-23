import { describe, expect, test } from "bun:test";
import {
  parsePrdFile,
  parseAcceptanceCriteria,
  parseDependsOn,
  parsePriority,
} from "../prd";

describe("parsePrdFile", () => {
  test("parses a complete PRD", () => {
    const content = `# Authentication

Priority: high
Depends-On: 000-foundation

## Acceptance Criteria

- [ ] AC-001 User can sign in with email and password
- [ ] AC-002 Invalid credentials show an error
- [x] AC-003 Auth session persists across refresh
`;

    const prd = parsePrdFile(content, "001-auth.md");
    expect(prd.id).toBe("001");
    expect(prd.title).toBe("Authentication");
    expect(prd.filename).toBe("001-auth.md");
    expect(prd.priority).toBe("high");
    expect(prd.dependsOn).toEqual(["000"]);
    expect(prd.criteria).toHaveLength(3);
    expect(prd.criteria[0]).toEqual({
      id: "AC-001",
      text: "User can sign in with email and password",
      checked: false,
    });
    expect(prd.criteria[2].checked).toBe(true);
  });

  test("extracts id from filename with leading zeros", () => {
    const prd = parsePrdFile("# Foo", "042-bar.md");
    expect(prd.id).toBe("042");
  });

  test("uses filename as title when no heading found", () => {
    const prd = parsePrdFile("no heading here", "001-test.md");
    expect(prd.title).toBe("001-test.md");
  });

  test("handles PRD title prefix", () => {
    const prd = parsePrdFile("# PRD 001: Auth System", "001-auth.md");
    expect(prd.title).toBe("Auth System");
  });
});

describe("parseAcceptanceCriteria", () => {
  test("parses criteria with AC- IDs", () => {
    const content = `## Acceptance Criteria

- [ ] AC-001 First thing
- [ ] AC-002 Second thing
- [x] AC-003 Done thing
`;
    const criteria = parseAcceptanceCriteria(content);
    expect(criteria).toHaveLength(3);
    expect(criteria[0].id).toBe("AC-001");
    expect(criteria[0].text).toBe("First thing");
    expect(criteria[0].checked).toBe(false);
    expect(criteria[2].checked).toBe(true);
  });

  test("returns empty array when no section found", () => {
    expect(parseAcceptanceCriteria("# Just a title")).toEqual([]);
  });

  test("ignores lines without AC- prefix", () => {
    const content = `## Acceptance Criteria

- [ ] AC-001 Valid
- [ ] No ID here
- Regular text
`;
    const criteria = parseAcceptanceCriteria(content);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].id).toBe("AC-001");
  });

  test("stops at next section", () => {
    const content = `## Acceptance Criteria

- [ ] AC-001 In scope

## Other Section

- [ ] AC-002 Out of scope
`;
    const criteria = parseAcceptanceCriteria(content);
    expect(criteria).toHaveLength(1);
  });
});

describe("parseDependsOn", () => {
  test("parses comma-separated dependencies", () => {
    const content = "Depends-On: 000-foundation, 001-routing";
    expect(parseDependsOn(content)).toEqual(["000", "001"]);
  });

  test("returns empty for no depends-on line", () => {
    expect(parseDependsOn("# Just a title")).toEqual([]);
  });
});

describe("parsePriority", () => {
  test("parses high priority", () => {
    expect(parsePriority("Priority: high")).toBe("high");
  });

  test("parses low priority", () => {
    expect(parsePriority("Priority: low")).toBe("low");
  });

  test("defaults to normal for unknown", () => {
    expect(parsePriority("Priority: critical")).toBe("normal");
  });

  test("defaults to normal when missing", () => {
    expect(parsePriority("# No priority")).toBe("normal");
  });
});
