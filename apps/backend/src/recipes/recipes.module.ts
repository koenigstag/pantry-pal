import { Module } from '@nestjs/common';

import { HouseholdsModule } from '../households/households.module';
import { IngredientLinker } from './ingredient-linker';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';

@Module({
  imports: [HouseholdsModule],
  controllers: [RecipesController],
  providers: [RecipesService, IngredientLinker],
  exports: [RecipesService],
})
export class RecipesModule {}
