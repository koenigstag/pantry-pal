import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { DefaultLocationsModule } from '../default-locations/default-locations.module';
import { RecipesModule } from '../recipes/recipes.module';
import { UnitsModule } from '../units/units.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminDefaultLocationsController } from './admin-default-locations.controller';
import { AdminRecipesController } from './admin-recipes.controller';
import { AdminUnitsController } from './admin-units.controller';
import { AdminUsersController } from './admin-users.controller';

/** Global reference data, defaults, recommended recipes and password resets. Every route here is `@AdminOnly()`. */
@Module({
  imports: [AuthModule, CategoriesModule, DefaultLocationsModule, RecipesModule, UnitsModule],
  controllers: [
    AdminCategoriesController,
    AdminDefaultLocationsController,
    AdminRecipesController,
    AdminUnitsController,
    AdminUsersController,
  ],
})
export class AdminModule {}
