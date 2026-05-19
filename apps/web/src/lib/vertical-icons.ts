import {
  GraduationCap,
  Dumbbell,
  ShoppingBag,
  Building2,
  Sandwich,
  Shirt,
  Beer,
  Stethoscope,
  Hotel,
  UtensilsCrossed,
  Trophy,
  Church,
  type LucideIcon,
} from 'lucide-react';
import type { Vertical } from '@cms/api-types';

/**
 * A professional line icon per business vertical. Marketing and
 * settings surfaces render these instead of the emoji set, so the
 * product reads as real software rather than a toy.
 */
export const VERTICAL_ICONS: Record<Vertical, LucideIcon> = {
  K12: GraduationCap,
  GYM: Dumbbell,
  RETAIL: ShoppingBag,
  CORPORATE: Building2,
  QSR: Sandwich,
  FASHION: Shirt,
  BAR: Beer,
  HEALTHCARE: Stethoscope,
  HOSPITALITY: Hotel,
  RESTAURANT: UtensilsCrossed,
  SPORTS: Trophy,
  WORSHIP: Church,
};
