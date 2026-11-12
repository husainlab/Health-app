// The shell finds a card's info text by its English title; a translated title keeps the text and shows its own name.
import { i18n } from "@/i18n/config";
import { cardInfo } from "@/ui/shells/cardInfo";

export const cardInfoFor = (id: string, title: string) => {
  if (id === "Circadian rhythm") return { title, body: i18n.t("sleep:circadian.info") };
  const info = cardInfo(id);
  return info ? { ...info, title } : undefined;
};
