/** Icon + click wiring for product slash rows — shared by Composer & Sidebar. */

import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  FlaskConical,
  GraduationCap,
  Image as ImageIcon,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  PRODUCT_SLASH_COMMANDS,
  type ProductSlashCommand,
  type ProductSlashCommandId,
} from '@/lib/chat/composer/slash-commands';

const ICONS: Record<ProductSlashCommandId, LucideIcon> = {
  image: ImageIcon,
  research: FlaskConical,
  papers: GraduationCap,
  books: BookOpen,
  skill: Sparkles,
  review: ShieldCheck,
  continue: Play,
};

export function slashCommandIcon(id: ProductSlashCommandId): LucideIcon {
  return ICONS[id];
}

export { PRODUCT_SLASH_COMMANDS };
export type { ProductSlashCommand, ProductSlashCommandId };
