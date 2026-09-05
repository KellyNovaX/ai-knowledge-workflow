import skillFile1 from "../../companion-skills/ai-knowledge-project-onboarding/SKILL.md";
import skillFile2 from "../../companion-skills/ai-knowledge-project-onboarding/agents/openai.yaml";
import skillFile3 from "../../companion-skills/ai-knowledge-project-onboarding/scripts/validate_knowledge.py";
import skillFile4 from "../../companion-skills/ai-knowledge-project-onboarding/templates/AGENTS.md";
import skillFile5 from "../../companion-skills/ai-knowledge-project-onboarding/templates/architecture.md";
import skillFile6 from "../../companion-skills/ai-knowledge-project-onboarding/templates/database.md";
import skillFile7 from "../../companion-skills/ai-knowledge-project-onboarding/templates/env.md";
import skillFile8 from "../../companion-skills/ai-knowledge-project-onboarding/templates/index.md";
import skillFile9 from "../../companion-skills/ai-knowledge-project-onboarding/templates/links.md";
import skillFile10 from "../../companion-skills/ai-knowledge-project-onboarding/templates/modules.md";
import skillFile11 from "../../companion-skills/ai-knowledge-project-onboarding/templates/runbook.md";
import skillFile12 from "../../companion-skills/ai-knowledge-task-management/SKILL.md";
import skillFile13 from "../../companion-skills/ai-knowledge-task-management/agents/openai.yaml";
import skillFile14 from "../../companion-skills/ai-knowledge-task-management/scripts/task_manager.py";
import skillFile15 from "../../companion-skills/ai-knowledge-weekly-summary/SKILL.md";
import skillFile16 from "../../companion-skills/ai-knowledge-weekly-summary/agents/openai.yaml";
import skillFile17 from "../../companion-skills/ai-knowledge-weekly-summary/scripts/collect_weekly_changes.py";

export const COMPANION_SKILLS_ROOT = ".agents/skills";

export enum CompanionSkillId {
  ProjectOnboarding = "ai-knowledge-project-onboarding",
  TaskManagement = "ai-knowledge-task-management",
  WeeklySummary = "ai-knowledge-weekly-summary"
}

// Fixed release resources; initialization writes copies without running them.
export const COMPANION_SKILL_FILES: Readonly<Record<string, string>> = {
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/SKILL.md"]: skillFile1,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/agents/openai.yaml"]: skillFile2,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/scripts/validate_knowledge.py"]: skillFile3,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/AGENTS.md"]: skillFile4,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/architecture.md"]: skillFile5,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/database.md"]: skillFile6,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/env.md"]: skillFile7,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/index.md"]: skillFile8,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/links.md"]: skillFile9,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/modules.md"]: skillFile10,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.ProjectOnboarding + "/templates/runbook.md"]: skillFile11,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.TaskManagement + "/SKILL.md"]: skillFile12,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.TaskManagement + "/agents/openai.yaml"]: skillFile13,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.TaskManagement + "/scripts/task_manager.py"]: skillFile14,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.WeeklySummary + "/SKILL.md"]: skillFile15,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.WeeklySummary + "/agents/openai.yaml"]: skillFile16,
  [COMPANION_SKILLS_ROOT + "/" + CompanionSkillId.WeeklySummary + "/scripts/collect_weekly_changes.py"]: skillFile17
};
