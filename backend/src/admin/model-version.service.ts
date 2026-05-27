import { prisma } from '../storage/prisma.js';

export class ModelVersionService {
  list() {
    return prisma.modelVersion.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
