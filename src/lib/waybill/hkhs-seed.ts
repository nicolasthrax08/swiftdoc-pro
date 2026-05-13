/**
 * Seed dictionary: common HK logistics product terms → HKHS codes
 *
 * Used to:
 *   1. Ground the Gemini HS-code resolution prompt with concrete examples.
 *   2. Provide a fast-path lookup before invoking the model (exact match).
 *
 * Keys are lowercase English product descriptions; values are 8-digit
 * HKHS codes (Hong Kong Harmonized System).
 *
 * Sources: HKHS Schedule + C&ED published classification rulings.
 */

export interface HkhsEntry {
  description: string; // normalised English description
  code: string; // 8-digit HKHS code
  cantonese?: string; // Cantonese term(s) for prompt grounding
}

export const HKHS_SEED: HkhsEntry[] = [
  // ── Fashion / textiles ───────────────────────────────────────────────────
  {
    description: "Handbag",
    code: "42022190",
    cantonese: "手袋",
  },
  {
    description: "Leather wallet",
    code: "42023100",
    cantonese: "皮夾 / 銀包",
  },
  {
    description: "Clothing / garments (general)",
    code: "62114200",
    cantonese: "衣物 / 衫褲",
  },
  {
    description: "T-shirt",
    code: "61091000",
    cantonese: "T恤 / 短袖衫",
  },
  {
    description: "Footwear / shoes",
    code: "64041100",
    cantonese: "鞋 / 皮鞋",
  },
  {
    description: "Sunglasses",
    code: "90041000",
    cantonese: "太陽眼鏡",
  },
  {
    description: "Watch",
    code: "91021200",
    cantonese: "手錶 / 腕錶",
  },
  {
    description: "Jewellery / jewelry",
    code: "71131990",
    cantonese: "珠寶 / 首飾",
  },
  // ── Electronics ─────────────────────────────────────────────────────────
  {
    description: "Electronics (general)",
    code: "85299090",
    cantonese: "電子產品",
  },
  {
    description: "Smartphone / mobile phone",
    code: "85171300",
    cantonese: "智能手機 / 手提電話",
  },
  {
    description: "Laptop / notebook computer",
    code: "84713000",
    cantonese: "手提電腦 / 筆記型電腦",
  },
  {
    description: "Tablet computer",
    code: "84713000",
    cantonese: "平板電腦",
  },
  {
    description: "Headphones / earphones",
    code: "85183000",
    cantonese: "耳機",
  },
  {
    description: "Portable speaker",
    code: "85182200",
    cantonese: "便攜式揚聲器 / 藍牙音箱",
  },
  {
    description: "Power bank / portable charger",
    code: "85044090",
    cantonese: "移動電源 / 充電寶",
  },
  {
    description: "Camera",
    code: "90065300",
    cantonese: "相機 / 攝影機",
  },
  // ── Food & beverages ─────────────────────────────────────────────────────
  {
    description: "Dried seafood",
    code: "03055990",
    cantonese: "海味 / 乾海鮮",
  },
  {
    description: "Chocolate / confectionery",
    code: "18069000",
    cantonese: "朱古力 / 糖果",
  },
  {
    description: "Tea",
    code: "09021000",
    cantonese: "茶葉",
  },
  {
    description: "Alcohol / spirits",
    code: "22084000",
    cantonese: "酒 / 烈酒",
  },
  // ── Cosmetics / personal care ─────────────────────────────────────────────
  {
    description: "Cosmetics / skincare",
    code: "33049900",
    cantonese: "化妝品 / 護膚品",
  },
  {
    description: "Perfume",
    code: "33030000",
    cantonese: "香水",
  },
  // ── Toys / sporting goods ─────────────────────────────────────────────────
  {
    description: "Toys",
    code: "95030000",
    cantonese: "玩具",
  },
  {
    description: "Sporting goods / equipment",
    code: "95069900",
    cantonese: "運動用品",
  },
  // ── Medical / health ────────────────────────────────────────────────────
  {
    description: "Medical devices",
    code: "90189090",
    cantonese: "醫療器材",
  },
  {
    description: "Vitamins / dietary supplements",
    code: "21069090",
    cantonese: "維他命 / 保健品",
  },
  // ── Documents / printed matter ───────────────────────────────────────────
  {
    description: "Documents / printed matter",
    code: "49019900",
    cantonese: "文件 / 印刷品",
  },
  // ── Automotive ───────────────────────────────────────────────────────────
  {
    description: "Automobile spare parts",
    code: "87089900",
    cantonese: "汽車零件",
  },
];

/**
 * Build the seed block that is injected into the HS-code resolution prompt.
 * Returns a compact table string.
 */
export function buildSeedPromptBlock(): string {
  const rows = HKHS_SEED.map(
    (e) =>
      `• ${e.description}${e.cantonese ? ` (${e.cantonese})` : ""} → ${e.code}`,
  ).join("\n");
  return `Reference HKHS codes for common HK logistics categories:\n${rows}`;
}

/**
 * Fast-path exact match lookup (case-insensitive).
 * Returns the 8-digit code or null if no match found.
 */
export function lookupHkhsCode(description: string): string | null {
  const normalised = description.toLowerCase().trim();
  for (const entry of HKHS_SEED) {
    if (
      entry.description.toLowerCase() === normalised ||
      (entry.cantonese?.toLowerCase().includes(normalised))
    ) {
      return entry.code;
    }
  }
  return null;
}
