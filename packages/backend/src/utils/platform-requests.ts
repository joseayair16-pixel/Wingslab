import { prisma } from '../config/database';
import * as fs from 'fs';
import * as path from 'path';

const TMP_DIR = path.join(__dirname, '../../.tmp');
const FALLBACK_FILE = path.join(TMP_DIR, 'platform_requests.json');

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

export function readFallbackRequests(): any[] {
  ensureTmpDir();
  if (!fs.existsSync(FALLBACK_FILE)) {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function writeFallbackRequests(requests: any[]) {
  ensureTmpDir();
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(requests, null, 2));
}

export async function getPlatformRequests() {
  try {
    // Try Prisma first
    return await prisma.platformRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.warn('Database error, falling back to JSON file for platform requests:', err);
    return readFallbackRequests();
  }
}

export async function getPlatformRequestById(id: string) {
  try {
    return await prisma.platformRequest.findUnique({
      where: { id },
    });
  } catch (err) {
    console.warn('Database error, falling back to JSON file for platform request lookup:', err);
    const requests = readFallbackRequests();
    return requests.find((r) => r.id === id) || null;
  }
}

export async function createPlatformRequest(data: {
  type: 'RESTAURANT' | 'DRIVER';
  ownerName: string;
  businessName?: string;
  giro?: string;
  whatsapp: string;
  location: string;
  motorcycle?: string;
}) {
  try {
    return await prisma.platformRequest.create({
      data,
    });
  } catch (err) {
    console.warn('Database error, falling back to JSON file for platform request creation:', err);
    const requests = readFallbackRequests();
    const newReq = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...data,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    requests.unshift(newReq);
    writeFallbackRequests(requests);
    return newReq;
  }
}

export async function updatePlatformRequestStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  try {
    return await prisma.platformRequest.update({
      where: { id },
      data: { status },
    });
  } catch (err) {
    console.warn('Database error, falling back to JSON file for platform request update:', err);
    const requests = readFallbackRequests();
    const req = requests.find((r) => r.id === id);
    if (req) {
      req.status = status;
      req.updatedAt = new Date().toISOString();
      writeFallbackRequests(requests);
    }
    return req || null;
  }
}
