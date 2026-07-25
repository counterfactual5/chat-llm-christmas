import { NextRequest } from 'next/server';
import { PUT as BasePUT, DELETE as BaseDELETE } from '../route';

export const runtime = 'edge';

export async function PUT(req: NextRequest) { return BasePUT(req); }
export async function DELETE(req: NextRequest) { return BaseDELETE(req); }
