import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { configuration } from './config/configuration';
import { HealthController } from './health/health.controller';
import { PantryModule } from './pantry/pantry.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      // `.env.local` holds developer-specific overrides and is git-ignored.
      envFilePath: ['.env.local', '.env'],
    }),
    PantryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
