import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@prisma/client';

const storeCategorySchema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio'),
  icon: z.string().min(1, 'El icono es obligatorio'),
  color: z.string().optional().nullable(),
  keywords: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  order: z.number().int().default(0),
});

export const registerAdminCategoriesRoutes = async (fastify: FastifyInstance) => {
  fastify.register(async (app) => {
    app.addHook('onRequest', authenticate);
    app.addHook('onRequest', authorize([UserRole.ADMIN]));

    // Get all categories
    app.get('/admin/store-categories', async (request, reply) => {
      try {
        const categories = await prisma.storeCategory.findMany({
          orderBy: { order: 'asc' },
        });

        return reply.send({
          success: true,
          data: categories,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error fetching categories' },
        });
      }
    });

    // Create a category
    app.post('/admin/store-categories', async (request, reply) => {
      try {
        const body = storeCategorySchema.parse(request.body);

        const category = await prisma.storeCategory.create({
          data: body,
        });

        return reply.status(201).send({
          success: true,
          data: category,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: { message: error.errors[0].message, code: 'VALIDATION_ERROR' },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { message: 'Error creating category' },
        });
      }
    });

    // Update a category
    app.put('/admin/store-categories/:id', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = storeCategorySchema.partial().parse(request.body);

        const category = await prisma.storeCategory.update({
          where: { id },
          data: body,
        });

        return reply.send({
          success: true,
          data: category,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: { message: error.errors[0].message, code: 'VALIDATION_ERROR' },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { message: 'Error updating category' },
        });
      }
    });

    // Delete a category
    app.delete('/admin/store-categories/:id', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        await prisma.storeCategory.delete({
          where: { id },
        });

        return reply.send({
          success: true,
          message: 'Category deleted successfully',
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error deleting category' },
        });
      }
    });
  });
};
