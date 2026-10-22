import type { Category } from "@freezer/shared/domain";

/** Material Symbols for each category (all listed in src/theme/icon-names.txt). */
export const CATEGORY_ICONS: Record<Category, string> = {
  meat: "kebab_dining",
  poultry: "egg",
  fish: "set_meal",
  vegetables: "grocery",
  fruit: "nutrition",
  herbs: "spa",
  baked: "bakery_dining",
  meals: "dinner_dining",
  soups: "soup_kitchen",
  dairy: "local_drink",
  desserts: "icecream",
  other: "category",
};
