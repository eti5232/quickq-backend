import { z } from 'zod';
import { booleanQuery, categoryEnum, paginationQuery } from '../../utils/validation.js';

export const searchClinicsSchema = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  category: categoryEnum.optional(),
  city: z.string().trim().max(60).optional(),
  openNow: booleanQuery.optional(),
  hasAvailabilityThisWeek: booleanQuery.optional(),
  sort: z.enum(['name', 'nextAvailable'], 'מיון לא תקין (name או nextAvailable)').default('name'),
});

export type SearchClinicsInput = z.infer<typeof searchClinicsSchema>;
