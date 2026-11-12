import Anthropic from "@anthropic-ai/sdk";

// Resolves ANTHROPIC_API_KEY from the environment. Never hardcode a key.
export const anthropic = new Anthropic();

export const MODEL = process.env.BAGINDEX_MODEL || "claude-opus-5";

// Evidence gathering runs on the fast model; the verdict (scoring) stays on MODEL.
/** Fast answers (Katie, 2026-10-24: "a couple of minutes ... not ideal"): skip web research when our tracker covers the bag; write at low effort. */
export const FAST = process.env.BAGINDEX_FAST !== "0";
export const RESEARCH_MODEL = process.env.BAGINDEX_RESEARCH_MODEL || "claude-sonnet-5";
