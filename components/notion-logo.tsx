import { cn } from '@/lib/utils';

/**
 * Official Notion app icon: black mark on a white rounded tile.
 * Brand colors stay fixed in light and dark mode (never invert / currentColor theme).
 */
export function NotionLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-white text-black shadow-[0_0_0_1px_rgba(0,0,0,0.06)]',
        className,
      )}
      aria-hidden
    >
      <svg
        role="img"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[82%] w-[82%]"
      >
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.9l14.523-.84c.841-.093.981-.56.981-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.047-.7.327-.7.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.696.514.886.747.886 1.4v16.47c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.495-1.632z" />
      </svg>
    </span>
  );
}
