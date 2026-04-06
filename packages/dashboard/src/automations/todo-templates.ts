import type { TodoItem, TodoTemplate } from "@my-agent/core";

const TEMPLATES: Record<string, TodoTemplate> = {
  capability_build: {
    items: [
      { text: "Read spec and capability template", mandatory: true },
      {
        text: "Write CAPABILITY.md with required frontmatter (name, provides, interface, requires.env)",
        mandatory: true,
        validation: "capability_frontmatter",
      },
      {
        text: "Write scripts following template contract",
        mandatory: true,
      },
      {
        text: "Run test harness — record result in deliverable.md frontmatter as test_result",
        mandatory: true,
        validation: "test_executed",
      },
      {
        text: "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)",
        mandatory: true,
        validation: "completion_report",
      },
    ],
  },
  capability_modify: {
    items: [
      {
        text: "Read current CAPABILITY.md + DECISIONS.md history",
        mandatory: true,
      },
      {
        text: "Identify change type (configure/upgrade/fix/replace) — write to deliverable.md frontmatter as change_type",
        mandatory: true,
        validation: "change_type_set",
      },
      { text: "Apply changes per spec", mandatory: true },
      {
        text: "Run test harness — record result in deliverable.md frontmatter as test_result",
        mandatory: true,
        validation: "test_executed",
      },
      {
        text: "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)",
        mandatory: true,
        validation: "completion_report",
      },
    ],
  },
};

export function getTemplate(jobType: string): TodoTemplate | undefined {
  return TEMPLATES[jobType];
}

export function assembleJobTodos(
  delegatorTodos?: Array<{ text: string }>,
  jobType?: string,
): TodoItem[] {
  const items: TodoItem[] = [];
  let nextId = 1;

  // Layer 1: Delegator's items
  if (delegatorTodos) {
    for (const todo of delegatorTodos) {
      items.push({
        id: `t${nextId++}`,
        text: todo.text,
        status: "pending",
        mandatory: true,
        created_by: "delegator",
      });
    }
  }

  // Layer 2: Job-type template items
  const template = jobType ? getTemplate(jobType) : undefined;
  if (template) {
    for (const tplItem of template.items) {
      items.push({
        id: `t${nextId++}`,
        text: tplItem.text,
        status: "pending",
        mandatory: tplItem.mandatory,
        validation: tplItem.validation,
        created_by: "framework",
      });
    }
  }

  return items;
}
