import { z } from "zod";
import { normalizeTaskStatusValue } from "../constants";
import {
  PlanAction,
  PlanConfidence,
  PlanDecision,
  TaskScope,
  TaskStatus,
  WorkflowType
} from "../types";

export const PlanQuestionSchema = z.object({
  field: z.string().trim().min(1, "questions[].field is required"),
  question: z.string().trim().min(1, "questions[].question is required"),
  options: z.array(z.string().trim().min(1, "questions[].options[] cannot be empty")).optional()
});

export const PlanMoveSchema = z.object({
  from: z.string().trim().min(1, "moves[].from is required"),
  to: z.string().trim().min(1, "moves[].to is required")
});

export const PlanTaskSchema = z.object({
  text: z.string().trim().min(1, "tasks[].text is required"),
  link: z.string().trim().min(1, "tasks[].link cannot be empty").optional()
});

export const WorkflowPlanSchema = z.object({
  decision: z.nativeEnum(PlanDecision),
  action: z.nativeEnum(PlanAction).optional(),
  task_scope: z.nativeEnum(TaskScope).optional(),
  project: z.string().trim().min(1, "project cannot be empty").nullable().optional(),
  related_projects: z.array(z.string().trim().min(1, "related_projects[] cannot be empty")).optional(),
  workflow_type: z.nativeEnum(WorkflowType).nullable().optional(),
  workflow_slug: z.string().trim().min(1, "workflow_slug cannot be empty").nullable().optional(),
  task_status: z.preprocess(
    (value) => normalizeTaskStatusValue(value, undefined),
    z.nativeEnum(TaskStatus).optional()
  ),
  confidence: z.nativeEnum(PlanConfidence),
  reason: z.string().trim().min(1, "reason cannot be empty").optional(),
  questions: z.array(PlanQuestionSchema),
  moves: z.array(PlanMoveSchema).optional(),
  tasks: z.array(PlanTaskSchema).optional()
}).strict();
