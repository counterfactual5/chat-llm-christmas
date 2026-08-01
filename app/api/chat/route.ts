import { NextRequest } from 'next/server';
import { handleChatRequest } from '@/lib/chat/server/chat-request';

export const runtime = 'edge';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleChatRequest(req);
}
