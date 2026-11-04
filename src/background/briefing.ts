// Generates AI-crafted notification insights if the user has enabled Coach / configured an AI API key.
// Makes direct HTTPS calls to the user's configured provider (Gemini, OpenAI, Anthropic, or custom).
// Strictly time-boxed (4 seconds) so notification delivery is never delayed if network or AI is unavailable.
import { generateText } from "ai";
import { apiKey, coachSetup } from "@/coach/storage";
import { PROVIDERS } from "@/coach/providers";

export type BriefingContext = {
  type: "recovery" | "strain" | "windDown";
  statsText: string;
};

/** Generates a personalized 1-2 sentence lock-screen coaching insight, or null on timeout/error/no key. */
export async function generateNotificationInsight(ctx: BriefingContext): Promise<string | null> {
  try {
    const [setup, key] = await Promise.all([coachSetup(), apiKey()]);
    if (!setup.consent || !setup.provider || !setup.model) return null;
    if (!key && setup.provider !== "custom") return null;

    const provider = PROVIDERS.find((p) => p.id === setup.provider);
    if (!provider) return null;

    const model = provider.create(key, setup.model, globalThis.fetch, setup.baseUrl ?? undefined);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);

    const typePrompt =
      ctx.type === "recovery"
        ? "Give an encouraging, actionable morning recovery summary and daily guidance (under 160 characters)."
        : ctx.type === "strain"
        ? "Give a motivating 1-sentence comment on reaching their strain target (under 140 characters)."
        : "Give a 1-sentence wind-down reminder to sleep well tonight (under 140 characters).";

    try {
      const result = await generateText({
        model,
        prompt: `You are an expert personal health coach. ${typePrompt} Do not use quotes, hashtags, or pleasantries.\nStats: ${ctx.statsText}`,
        maxOutputTokens: 60,
        abortSignal: ctl.signal,
      });
      const text = result.text?.trim().replace(/^["']|["']$/g, "");
      return text && text.length > 10 ? text : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
