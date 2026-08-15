export type Price = { market: number | null; low: number | null; high: number | null; source: string; variant?: string };
export type Card = {
  id: string; name: string; setName: string; setCode: string; number: string; rarity: string;
  type: string; hp?: string; stage?: string; text?: string; attacks?: string[]; weakness?: string;
  evolvesFrom?: string; resistance?: string; retreatCost?: string; illustrator?: string;
  regulationMark?: string; abilities?: string[]; printedTotal?: string;
  imageUrl: string; prices: Price[]; confidence?: number;
};
